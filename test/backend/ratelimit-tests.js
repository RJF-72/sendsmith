const assert = require('assert');
const ratelimit = require('../../server/middleware/ratelimit');

describe('Rate limiter (Redis fixed window)', function() {
  it('allows up to max, then blocks with a retry hint', async function() {
    const key = `test-scope:10.9.9.${Math.floor(Math.random() * 200 + 2)}`;
    const opts = { max: 2, windowSeconds: 3600 };
    const first = await ratelimit.check(key, opts);
    assert.strictEqual(first.allowed, true);
    assert.strictEqual(first.count, 1);
    const second = await ratelimit.check(key, opts);
    assert.strictEqual(second.allowed, true);
    assert.strictEqual(second.count, 2);
    const third = await ratelimit.check(key, opts);
    assert.strictEqual(third.allowed, false);
    assert.ok(third.retryAfter >= 1);
  });

  it('keys windows per IP and per scope', async function() {
    const opts = { max: 1, windowSeconds: 3600 };
    const a = await ratelimit.check('scope-a:10.8.8.8', opts);
    assert.strictEqual(a.allowed, true);
    const b = await ratelimit.check('scope-a:10.8.8.9', opts);
    assert.strictEqual(b.allowed, true, 'different IP unaffected');
    const c = await ratelimit.check('scope-b:10.8.8.8', opts);
    assert.strictEqual(c.allowed, true, 'different scope unaffected');
    const d = await ratelimit.check('scope-a:10.8.8.8', opts);
    assert.strictEqual(d.allowed, false, 'same scope+IP blocked');
  });

  it('clientIp prefers req.ip and strips IPv6-mapped prefixes', function() {
    // Express (with trust proxy enabled, see server/routes) derives
    // req.ip from X-Forwarded-For; the WS server sets it from the
    // socket. clientIp just normalizes what it is given.
    assert.strictEqual(
      ratelimit.clientIp({ headers: {}, ip: '203.0.113.7' }),
      '203.0.113.7'
    );
    assert.strictEqual(
      ratelimit.clientIp({ headers: {}, ip: '::ffff:192.0.2.1' }),
      '192.0.2.1'
    );
    assert.strictEqual(
      ratelimit.clientIp({
        headers: {},
        socket: { remoteAddress: '::ffff:198.51.100.3' }
      }),
      '198.51.100.3'
    );
  });
});
