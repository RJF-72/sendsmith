/*
 * SendSmith billing routes. All of them 404 when billing is not
 * configured, so the feature is genuinely hidden without Stripe keys.
 * New SendSmith code.
 */
const billing = require('../billing');
const users = require('../users');

module.exports = {
  async checkout(req, res) {
    if (!billing.enabled()) {
      return res.sendStatus(404);
    }
    const user = await users.verifyRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'not_logged_in' });
    }
    try {
      const session = await billing.createCheckoutSession(user);
      res.json({ url: session.url });
    } catch (e) {
      res.status(502).json({ error: 'checkout_failed' });
    }
  },

  async portal(req, res) {
    if (!billing.enabled()) {
      return res.sendStatus(404);
    }
    const user = await users.verifyRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'not_logged_in' });
    }
    try {
      const session = await billing.createPortalSession(user);
      if (!session) {
        return res.status(400).json({ error: 'no_customer' });
      }
      res.json({ url: session.url });
    } catch (e) {
      res.status(502).json({ error: 'portal_failed' });
    }
  },

  async webhook(req, res) {
    if (!billing.enabled()) {
      return res.sendStatus(404);
    }
    // req.body is the raw Buffer (mounted with bodyParser.raw in
    // routes/index.js before the JSON parser).
    const status = await billing.handleWebhook(
      req.body,
      req.header('stripe-signature')
    );
    res.sendStatus(status);
  }
};
