#!/usr/bin/env node
/*
 * SendSmith feature verification — boots throwaway server instances
 * (real Redis if REDIS_HOST is reachable, redis-mock otherwise) and
 * exercises the Phase 3/4 behaviors end-to-end:
 *
 *   1. accounts: signup/duplicate/weak-password/login/me/logout
 *   2. billing seam hidden when Stripe is unconfigured (404)
 *   3. public abuse report FLAGS a file without killing it, and the
 *      flag lands in the admin queue
 *   4. report rate limit trips (429)
 *   5. anonymous size limit enforced (413) while an account upload of
 *      the same size succeeds, and the account's quota counter moves
 *   6. upload rate limit trips (server error 429)
 *
 * Usage: node scripts/verify-features.js
 * Exits non-zero if any check fails. Servers are spawned on ports
 * 15443/15444 with temp FILE_DIRs and killed at the end.
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const RS = 1024 * 64;
const results = [];
function check(name, cond, extra) {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function hkdf(ikm, salt, info, len) {
  const saltKey = salt && salt.length ? salt : Buffer.alloc(32);
  const prk = crypto.createHmac('sha256', saltKey).update(ikm).digest();
  let out = Buffer.alloc(0);
  let t = Buffer.alloc(0);
  let i = 0;
  while (out.length < len) {
    i += 1;
    t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(info, 'utf8'), Buffer.from([i])])).digest();
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
  const maxChunk = RS - 17;
  do {
    const isLast = offset + maxChunk >= plain.length;
    const chunk = plain.slice(offset, offset + maxChunk);
    const nonce = Buffer.from(nonceBase);
    nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ seq) >>> 0, 8);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
    const body = Buffer.concat([chunk, Buffer.from([isLast ? 2 : 1])]);
    const padded = isLast ? body : Buffer.concat([body, Buffer.alloc(RS - 16 - body.length)]);
    records.push(Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]));
    offset += chunk.length;
    seq += 1;
    if (isLast) break;
  } while (offset < plain.length);
  return Buffer.concat([header].concat(records));
}

function req(port, method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port, path: p, method, headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function upload(port, payload, secret, opts = {}) {
  return new Promise((resolve, reject) => {
    const authKey = hkdf(secret, null, 'authentication', 32);
    const metaKey = hkdf(secret, null, 'metadata', 16);
    const metaJson = JSON.stringify({ name: opts.name || 'v.txt', size: opts.plainSize || 0, type: 'text/plain', manifest: {} });
    const mc = crypto.createCipheriv('aes-128-gcm', metaKey, Buffer.alloc(12));
    const encMeta = Buffer.concat([mc.update(metaJson, 'utf8'), mc.final(), mc.getAuthTag()]);
    const headers = opts.cookie ? { Cookie: opts.cookie } : {};
    const ws = new WebSocket(`ws://localhost:${port}/api/ws`, { headers });
    let info = null;
    const timer = setTimeout(() => reject(new Error('upload timeout')), 15000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        fileMetadata: encMeta.toString('base64'),
        authorization: 'send-v1 ' + authKey.toString('base64'),
        timeLimit: opts.timeLimit || 3600,
        dlimit: opts.dlimit || 5
      }));
    });
    ws.on('message', m => {
      const msg = JSON.parse(m.toString());
      if (msg.error) {
        clearTimeout(timer);
        return reject(Object.assign(new Error('server error ' + msg.error), { code: msg.error }));
      }
      if (!info) {
        info = msg;
        ws.send(payload);
        ws.send(Buffer.from([0]));
      } else if (msg.ok) {
        clearTimeout(timer);
        ws.close();
        resolve(info);
      }
    });
    ws.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function boot(port, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sendsmith-verify-'));
  const env = {
    ...process.env,
    PORT: String(port),
    BASE_URL: `http://localhost:${port}`,
    FILE_DIR: dir,
    NODE_ENV: 'development',
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server/bin/prod.js'], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logBuf = '';
  child.stdout.on('data', d => (logBuf += d));
  child.stderr.on('data', d => (logBuf += d));
  for (let i = 0; i < 50; i++) {
    try {
      const res = await req(port, 'GET', '/__lbheartbeat__');
      if (res.status === 200) return { child, dir, log: () => logBuf };
    } catch (e) {
      // not up yet
    }
    await sleep(300);
  }
  child.kill('SIGKILL');
  throw new Error('server did not come up on port ' + port + '\n' + logBuf);
}

(async () => {
  const redisEnv = process.env.REDIS_HOST
    ? { REDIS_HOST: process.env.REDIS_HOST, REDIS_PORT: process.env.REDIS_PORT || '6379' }
    : {};
  console.log(`storage backend for verify: ${redisEnv.REDIS_HOST ? 'real redis @ ' + redisEnv.REDIS_HOST : 'redis-mock (set REDIS_HOST to use a real one)'}`);

  // ---------- Server A: feature checks ----------
  const A = await boot(15443, { ...redisEnv, RATELIMIT_REPORT_MAX: '3' });
  try {
    const email = `verify-${Date.now()}@example.com`;
    const password = 'a long enough password';

    let res = await req(15443, 'POST', '/api/auth/signup', { 'Content-Type': 'application/json' }, JSON.stringify({ email, password }));
    check('signup returns 201', res.status === 201, `status=${res.status}`);
    const setCookie = (res.headers['set-cookie'] || []).join(';');
    check('signup sets httpOnly session cookie', /sendsmith_session=/.test(setCookie) && /HttpOnly/i.test(setCookie));
    const cookie = setCookie.split(';')[0];

    res = await req(15443, 'POST', '/api/auth/signup', { 'Content-Type': 'application/json' }, JSON.stringify({ email, password }));
    check('duplicate signup rejected 409', res.status === 409, `status=${res.status}`);

    res = await req(15443, 'POST', '/api/auth/signup', { 'Content-Type': 'application/json' }, JSON.stringify({ email: 'weak@example.com', password: 'short' }));
    check('weak password rejected 400', res.status === 400, `status=${res.status}`);

    res = await req(15443, 'POST', '/api/auth/login', { 'Content-Type': 'application/json' }, JSON.stringify({ email, password: 'wrong password!' }));
    check('wrong-password login rejected 401', res.status === 401, `status=${res.status}`);

    res = await req(15443, 'GET', '/api/auth/me', { Cookie: cookie });
    const me = JSON.parse(res.body.toString());
    check('/api/auth/me shows logged-in free account', res.status === 200 && me.loggedIn === true && me.tier === 'free' && me.email === email, JSON.stringify(me));

    res = await req(15443, 'POST', '/api/billing/checkout', { Cookie: cookie, 'Content-Type': 'application/json' }, '{}');
    check('billing checkout hidden (404) when Stripe unconfigured', res.status === 404, `status=${res.status}`);

    // upload a file anonymously, then public-report it
    const secret = crypto.randomBytes(16);
    const plain = Buffer.from('report me — ' + crypto.randomBytes(200).toString('hex'));
    const up = await upload(15443, eceEncrypt(plain, secret), secret, { plainSize: plain.length, dlimit: 5 });
    check('anon upload works', !!up.id, `id=${up.id}`);

    res = await req(15443, 'POST', '/api/public-report', { 'Content-Type': 'application/json' }, JSON.stringify({ id: up.id, reason: 'Malware' }));
    check('public report accepted', res.status === 200, `status=${res.status}`);

    res = await req(15443, 'GET', `/api/exists/${up.id}`);
    check('publicly-reported file is NOT killed (flag only)', res.status === 200, `status=${res.status}`);

    // rate limit: RATELIMIT_REPORT_MAX=3 → two more succeed, then 429
    await req(15443, 'POST', '/api/public-report', { 'Content-Type': 'application/json' }, JSON.stringify({ id: up.id, reason: 'Abuse' }));
    await req(15443, 'POST', '/api/public-report', { 'Content-Type': 'application/json' }, JSON.stringify({ id: up.id, reason: 'Other' }));
    res = await req(15443, 'POST', '/api/public-report', { 'Content-Type': 'application/json' }, JSON.stringify({ id: up.id, reason: 'Other' }));
    check('report rate limit trips with 429', res.status === 429, `status=${res.status}`);

    // logout kills the session
    res = await req(15443, 'POST', '/api/auth/logout', { Cookie: cookie });
    check('logout returns 200', res.status === 200, `status=${res.status}`);
    res = await req(15443, 'GET', '/api/auth/me', { Cookie: cookie });
    const meAfter = JSON.parse(res.body.toString());
    check('session invalid after logout', meAfter.loggedIn === false, JSON.stringify(meAfter));

    // the flags must be visible to the admin tooling (same Redis)
    const { execFile } = require('child_process');
    const listOut = await new Promise((resolve, reject) => {
      execFile(process.execPath, ['scripts/admin-takedown.js', '--list-reports'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...redisEnv }
      }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    check('admin queue lists the public report', listOut.includes(up.id), listOut.trim().split('\n')[0]);
  } finally {
    A.child.kill('SIGKILL');
  }

  // ---------- Server B: anon vs account limits + quota + upload rate limit ----------
  const B = await boot(15444, { ...redisEnv, ANON_MAX_FILE_SIZE: '1024', RATELIMIT_UPLOAD_MAX: '4' });
  try {
    const bigPlain = crypto.randomBytes(4096);
    const bigSecret = crypto.randomBytes(16);
    let anonError = null;
    try {
      await upload(15444, eceEncrypt(bigPlain, bigSecret), bigSecret, { plainSize: bigPlain.length, dlimit: 5 });
    } catch (e) {
      anonError = e;
    }
    check('anon upload over 1KB cap rejected (413)', !!anonError && anonError.code === 413, anonError && anonError.message);

    const email = `limits-${Date.now()}@example.com`;
    const password = 'a long enough password';
    let res = await req(15444, 'POST', '/api/auth/signup', { 'Content-Type': 'application/json' }, JSON.stringify({ email, password }));
    const cookie = (res.headers['set-cookie'] || []).join(';').split(';')[0];
    check('account signup on limits server', res.status === 201, `status=${res.status}`);

    const acctSecret = crypto.randomBytes(16);
    const up = await upload(15444, eceEncrypt(bigPlain, acctSecret), acctSecret, { plainSize: bigPlain.length, dlimit: 5, cookie });
    check('account upload of same 4KB file succeeds', !!up.id, `id=${up.id}`);

    res = await req(15444, 'GET', '/api/auth/me', { Cookie: cookie });
    const me = JSON.parse(res.body.toString());
    check('monthly quota counter moved after account upload', me.usageBytes > 0, `usageBytes=${me.usageBytes}`);

    // upload rate limit: RATELIMIT_UPLOAD_MAX=4 per hour per IP.
    // Already used from this IP on server B: 1 anon attempt + 1 account = 2.
    let lastError = null;
    for (let i = 0; i < 4; i++) {
      try {
        const s = crypto.randomBytes(16);
        const p = Buffer.from('x' + i);
        await upload(15444, eceEncrypt(p, s), s, { plainSize: p.length, dlimit: 1 });
        lastError = null;
      } catch (e) {
        lastError = e;
      }
    }
    check('upload rate limit trips with 429', !!lastError && lastError.code === 429, lastError && lastError.message);
  } finally {
    B.child.kill('SIGKILL');
  }

  console.log(results.join('\n'));
})().catch(e => {
  console.log(results.join('\n'));
  console.error('VERIFY ERROR:', e && e.message);
  process.exit(2);
});
