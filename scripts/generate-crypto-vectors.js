/* One-off generator for the golden vectors frozen into
 * test/backend/crypto-vectors-tests.js. Kept in the repo so the vectors
 * can be regenerated and audited; the test file's constants were
 * produced by running this script on Node 22 with the manual HKDF/ECE
 * implementations (the same code the protocol-faithful e2e client
 * uses, which round-trips byte-identically with the browser app). */
const crypto = require('crypto');

function hkdfManual(ikm, salt, info, len) {
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

const RS = 1024 * 64;
function eceEncrypt(plain, secret, salt) {
  const key = hkdfManual(secret, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonceBase = hkdfManual(secret, salt, 'Content-Encoding: nonce\0', 16).slice(0, 12);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header.writeUInt8(0, 20);
  const records = [];
  let seq = 0;
  let offset = 0;
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

const secret = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const salt = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
const plain = Buffer.from('SendSmith golden vector payload — do not change.', 'utf8');

const authKeyManual = hkdfManual(secret, null, 'authentication', 32);
const authKeyBuiltin = crypto.hkdfSync('sha256', secret, Buffer.alloc(32), 'authentication', 32);
console.log('authKey manual==builtin:', authKeyManual.equals(Buffer.from(authKeyBuiltin)));
console.log('authKey:', authKeyManual.toString('hex'));
console.log('metaKey:', hkdfManual(secret, null, 'metadata', 16).toString('hex'));
const nonce = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
const sig = crypto.createHmac('sha256', authKeyManual).update(nonce).digest();
console.log('nonce:', nonce.toString('base64'));
console.log('hmacSig:', sig.toString('base64'));
const ece = eceEncrypt(plain, secret, salt);
console.log('ece len:', ece.length);
console.log('ece:', ece.toString('hex'));
const pbk = crypto.pbkdf2Sync('correct horse battery staple', 'https://example.com/download/abc123/#AAAA', 100, 32, 'sha256');
console.log('pbkdf2:', pbk.toString('hex'));
const metaKey = hkdfManual(secret, null, 'metadata', 16);
const mc = crypto.createCipheriv('aes-128-gcm', metaKey, Buffer.alloc(12));
const metaJson = JSON.stringify({ name: 'golden.txt', size: 1234, type: 'text/plain', manifest: {} });
const encMeta = Buffer.concat([mc.update(metaJson, 'utf8'), mc.final(), mc.getAuthTag()]);
console.log('encMeta:', encMeta.toString('base64'));
