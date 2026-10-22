const assert = require('assert');
const users = require('../../server/users');

describe('Users (SendSmith accounts)', function() {
  let counter = 0;
  function uniqueEmail() {
    counter += 1;
    return `user${counter}-${Date.now()}@example.com`;
  }

  it('hashes passwords with scrypt and verifies them', async function() {
    const stored = await users.hashPassword('a long enough password');
    assert.ok(stored.startsWith('scrypt$'), 'self-describing hash format');
    assert.strictEqual(await users.verifyPassword('a long enough password', stored), true);
    assert.strictEqual(await users.verifyPassword('wrong password here', stored), false);
    assert.strictEqual(await users.verifyPassword('a long enough password', 'bogus'), false);
  });

  it('creates users, rejects duplicates, authenticates', async function() {
    const email = uniqueEmail();
    const user = await users.createUser(email, 'a long enough password');
    assert.ok(user.id);
    assert.strictEqual(user.tier, 'free');
    await assert.rejects(
      () => users.createUser(email, 'a long enough password'),
      err => err.message === 'email_taken'
    );
    const authed = await users.authenticate(email, 'a long enough password');
    assert.strictEqual(authed.id, user.id);
    assert.strictEqual(await users.authenticate(email, 'nope nope nope'), null);
    assert.strictEqual(await users.authenticate('nobody@example.com', 'a long enough password'), null);
  });

  it('issues, verifies, and destroys sessions', async function() {
    const email = uniqueEmail();
    const user = await users.createUser(email, 'a long enough password');
    const token = await users.createSession(user.id);
    assert.ok(token && token.length > 20);
    const req = { headers: { cookie: `sendsmith_session=${token}` } };
    const verified = await users.verifyRequest(req);
    assert.strictEqual(verified.id, user.id);
    await users.destroySession(token);
    assert.strictEqual(await users.verifyRequest(req), null);
  });

  it('tracks monthly usage against the tier quota', async function() {
    const email = uniqueEmail();
    const user = await users.createUser(email, 'a long enough password');
    assert.strictEqual(await users.getUsage(user.id), 0);
    const quota = await users.checkQuota(user);
    assert.strictEqual(quota.ok, true);
    assert.strictEqual(quota.limit, users.quotaLimitFor(user));
    await users.addUsage(user.id, 1024);
    assert.strictEqual(await users.getUsage(user.id), 1024);
    await users.setTier(user.id, 'pro');
    const upgraded = await users.getUserById(user.id);
    assert.strictEqual(upgraded.tier, 'pro');
    assert.strictEqual(
      users.quotaLimitFor(upgraded) > users.quotaLimitFor(user),
      true
    );
  });
});
