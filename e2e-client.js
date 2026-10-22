/* E2E evaluation client for Firefox Send (mozilla/send) — NOT part of upstream.
 * Implements the real Send protocol: HKDF key derivation (app/keychain.js),
 * RFC 8188 ECE file encryption (app/ece.js), WebSocket upload (app/api.js),
 * send-v1 HMAC auth (server/middleware/auth.js). Run with Node 12. */
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

const HOST = 'localhost';
const PORT = 1443;
const RS = 1024 * 64;

function hkdf(ikm, salt, info, len) {
  const saltKey = salt && salt.length ? salt : Buffer.alloc(32);
  const prk = crypto.createHmac('sha256', saltKey).update(ikm).digest();
  let out = Buffer.alloc(0);
  let t = Buffer.alloc(0);
  let i = 0;
  while (out.length < len) {
    i += 1;
    t = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([t, Buffer.from(info, 'utf8'), Buffer.from([i])]))
      .digest();
    out = Buffer.concat([out, t]);
  }
  return out.slice(0, len);
}

function eceEncrypt(plain, secret) {
  const salt = crypto.randomBytes(16);
  const key = hkdf(secret, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonceBase = hkdf(secret, salt, 'Content-Encoding: nonce\0', 16).slice(0, 12);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header.writeUInt8(0, 20);
  const records = [];
  let seq = 0;
  let offset = 0;
  // chunks of RS-17 max plaintext (tag 16 + delimiter 1)
  const maxChunk = RS - 17;
  do {
    const isLast = offset + maxChunk >= plain.length;
    const chunk = plain.slice(offset, offset + maxChunk);
    const nonce = Buffer.from(nonceBase);
    nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ seq) >>> 0, 8);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
    const body = Buffer.concat([chunk, Buffer.from([isLast ? 2 : 1])]);
    const padded = isLast ? body : Buffer.concat([body, Buffer.alloc(RS - 16 - body.length)]);
    const enc = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
    records.push(enc);
    offset += chunk.length;
    seq += 1;
    if (isLast) break;
  } while (offset < plain.length);
  return Buffer.concat([header].concat(records));
}

function eceDecrypt(data, secret) {
  const salt = data.slice(0, 16);
  const rs = data.readUInt32BE(16);
  const key = hkdf(secret, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonceBase = hkdf(secret, salt, 'Content-Encoding: nonce\0', 16).slice(0, 12);
  let offset = 21;
  let seq = 0;
  const out = [];
  while (offset < data.length) {
    const recLen = Math.min(rs, data.length - offset);
    const isLast = offset + recLen >= data.length;
    const rec = data.slice(offset, offset + recLen);
    const nonce = Buffer.from(nonceBase);
    nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ seq) >>> 0, 8);
    const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
    decipher.setAuthTag(rec.slice(rec.length - 16));
    const dec = Buffer.concat([
      decipher.update(rec.slice(0, rec.length - 16)),
      decipher.final()
    ]);
    // unpad: strip trailing zeros, then delimiter
    let i = dec.length - 1;
    while (i >= 0 && dec[i] === 0) i -= 1;
    const delim = dec[i];
    if (delim !== (isLast ? 2 : 1)) throw new Error('bad delimiter ' + delim);
    out.push(dec.slice(0, i));
    offset += recLen;
    seq += 1;
  }
  return Buffer.concat(out);
}

function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: HOST, port: PORT, path, method, headers: headers || {} },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function upload(payload, secret, opts) {
  return new Promise((resolve, reject) => {
    const authKey = hkdf(secret, null, 'authentication', 32);
    const metaKey = hkdf(secret, null, 'metadata', 16);
    const metaJson = JSON.stringify({
      name: opts.name,
      size: opts.plainSize,
      type: 'text/plain',
      manifest: {}
    });
    const mc = crypto.createCipheriv('aes-128-gcm', metaKey, Buffer.alloc(12));
    const encMeta = Buffer.concat([mc.update(metaJson, 'utf8'), mc.final(), mc.getAuthTag()]);
    const ws = new WebSocket(`ws://${HOST}:${PORT}/api/ws`);
    let info = null;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          fileMetadata: encMeta.toString('base64'),
          authorization: 'send-v1 ' + authKey.toString('base64'),
          timeLimit: opts.timeLimit,
          dlimit: opts.dlimit
        })
      );
    });
    ws.on('message', m => {
      const msg = JSON.parse(m.toString());
      if (msg.error) return reject(new Error('server error ' + msg.error));
      if (!info) {
        info = msg;
        ws.send(payload);
        ws.send(Buffer.from([0])); // EOF marker, mirrors app/api.js
      } else if (msg.ok) {
        ws.close();
        resolve(info);
      }
    });
    ws.on('error', reject);
  });
}

function authHeaderFor(secret, nonceB64) {
  const authKey = hkdf(secret, null, 'authentication', 32);
  const sig = crypto
    .createHmac('sha256', authKey)
    .update(Buffer.from(nonceB64, 'base64'))
    .digest();
  return 'send-v1 ' + sig.toString('base64');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, cond, extra) {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const plain = Buffer.from(
    'SendSmith E2E test payload — ' + crypto.randomBytes(2000).toString('hex'),
    'utf8'
  );
  const plainHash = crypto.createHash('sha256').update(plain).digest('hex');

  // --- Test 1: upload, metadata, download round-trip, 1-download deletion ---
  const secret1 = crypto.randomBytes(16);
  const enc1 = eceEncrypt(plain, secret1);
  const up1 = await upload(enc1, secret1, { name: 'hello.txt', plainSize: plain.length, timeLimit: 3600, dlimit: 1 });
  check('upload returns id/url/ownerToken', !!(up1.id && up1.url && up1.ownerToken), `id=${up1.id} url=${up1.url}`);

  const ex1 = await req('GET', `/api/exists/${up1.id}`);
  check('exists after upload', ex1.status === 200, `status=${ex1.status}`);
  const nonce1 = (ex1.headers['www-authenticate'] || '').replace('send-v1 ', '');

  const metaRes = await req('GET', `/api/metadata/${up1.id}`, {
    Authorization: authHeaderFor(secret1, nonce1)
  });
  let metaOk = false;
  if (metaRes.status === 200) {
    const mj = JSON.parse(metaRes.body.toString());
    const metaKey = hkdf(secret1, null, 'metadata', 16);
    const raw = Buffer.from(mj.metadata, 'base64');
    const md = crypto.createDecipheriv('aes-128-gcm', metaKey, Buffer.alloc(12));
    md.setAuthTag(raw.slice(raw.length - 16));
    const dec = Buffer.concat([md.update(raw.slice(0, raw.length - 16)), md.final()]);
    const parsed = JSON.parse(dec.toString());
    metaOk = parsed.name === 'hello.txt' && parsed.size === plain.length;
  }
  check('encrypted metadata round-trip', metaOk);

  // NOTE: each successful send-v1 auth ROTATES the nonce (server/middleware/auth.js);
  // the fresh nonce arrives in the response's WWW-Authenticate header.
  const nonce1b = (metaRes.headers['www-authenticate'] || '').replace('send-v1 ', '') || nonce1;
  const tokRes = await req('GET', `/api/download/token/${up1.id}`, {
    Authorization: authHeaderFor(secret1, nonce1b)
  });
  const token = tokRes.status === 200 ? JSON.parse(tokRes.body.toString()).token : null;
  check('download token issued', !!token, `status=${tokRes.status}`);

  const dlRes = await req('GET', `/api/download/${up1.id}`, { Authorization: `Bearer ${token}` });
  let bytesOk = false;
  if (dlRes.status === 200) {
    const dec = eceDecrypt(dlRes.body, secret1);
    bytesOk = crypto.createHash('sha256').update(dec).digest('hex') === plainHash;
  }
  check('download decrypts byte-identical (sha256 match)', bytesOk, `status=${dlRes.status}, ${dlRes.body.length} bytes encrypted`);

  const doneRes = await req('POST', `/api/download/done/${up1.id}`, { Authorization: `Bearer ${token}` });
  check('download/done acknowledged', doneRes.status === 200, `status=${doneRes.status}`);
  await sleep(300);
  const exAfter = await req('GET', `/api/exists/${up1.id}`);
  check('file deleted after 1 download (dlimit=1)', exAfter.status === 404, `status=${exAfter.status}`);

  // --- Test 2: report/flag kills a link immediately ---
  const secret2 = crypto.randomBytes(16);
  const up2 = await upload(eceEncrypt(plain, secret2), secret2, { name: 'b.txt', plainSize: plain.length, timeLimit: 3600, dlimit: 5 });
  const ex2 = await req('GET', `/api/exists/${up2.id}`);
  const nonce2 = (ex2.headers['www-authenticate'] || '').replace('send-v1 ', '');
  const repRes = await req(
    'POST',
    `/api/report/${up2.id}`,
    { Authorization: authHeaderFor(secret2, nonce2), 'Content-Type': 'application/json' },
    JSON.stringify({ reason: 'Malware' })
  );
  check('report endpoint accepts report', repRes.status === 200, `status=${repRes.status}`);
  const ex2After = await req('GET', `/api/exists/${up2.id}`);
  check('reported file link is dead immediately', ex2After.status === 404, `status=${ex2After.status}`);

  // --- Test 3: TTL expiry ---
  const secret3 = crypto.randomBytes(16);
  const up3 = await upload(eceEncrypt(plain, secret3), secret3, { name: 'c.txt', plainSize: plain.length, timeLimit: 5, dlimit: 5 });
  const ex3 = await req('GET', `/api/exists/${up3.id}`);
  check('short-TTL file exists before expiry', ex3.status === 200, `status=${ex3.status}`);
  await sleep(7000);
  const ex3After = await req('GET', `/api/exists/${up3.id}`);
  check('file gone after 5s TTL expiry', ex3After.status === 404, `status=${ex3After.status}`);

  console.log(results.join('\n'));
})().catch(e => {
  console.log(results.join('\n'));
  console.error('E2E ERROR:', e && e.message);
  // eslint-disable-next-line no-process-exit
  process.exit(2);
});
