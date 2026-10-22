/*
 * SendSmith account routes: signup / login / logout / me.
 * Sessions are opaque tokens in Redis, delivered as an httpOnly
 * cookie (see server/users.js). New SendSmith code.
 */
const config = require('../config');
const users = require('../users');

function isSecure(req) {
  return config.env === 'production';
}

function publicUser(user) {
  return { id: user.id, email: user.email, tier: user.tier };
}

module.exports = {
  async signup(req, res) {
    try {
      const { email, password } = req.body || {};
      const user = await users.createUser(email, password);
      const token = await users.createSession(user.id);
      res.set('Set-Cookie', users.sessionCookie(token, { secure: isSecure(req) }));
      res.status(201).json(publicUser(user));
    } catch (e) {
      if (e.code === 'email_taken') {
        return res.status(409).json({ error: 'email_taken' });
      }
      if (e.code === 'invalid_email' || e.code === 'weak_password') {
        return res.status(400).json({ error: e.code });
      }
      res.status(500).json({ error: 'internal' });
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body || {};
      const user = await users.authenticate(email, password);
      if (!user) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const token = await users.createSession(user.id);
      res.set('Set-Cookie', users.sessionCookie(token, { secure: isSecure(req) }));
      res.json(publicUser(user));
    } catch (e) {
      res.status(500).json({ error: 'internal' });
    }
  },

  async logout(req, res) {
    try {
      const token = users.sessionTokenFromRequest(req);
      await users.destroySession(token);
    } catch (e) {
      // logout is best-effort; always clear the cookie
    }
    res.set('Set-Cookie', users.clearSessionCookie({ secure: isSecure(req) }));
    res.json({ ok: true });
  },

  async me(req, res) {
    const user = await users.verifyRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'not_logged_in' });
    }
    const quota = await users.checkQuota(user);
    res.json({
      ...publicUser(user),
      usage: quota.usage,
      quota: quota.limit
    });
  }
};
