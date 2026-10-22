/*
 * SendSmith billing: Stripe seam for the "Pro" tier.
 *
 * Everything here is inert unless STRIPE_SECRET_KEY, STRIPE_PRICE_ID
 * and STRIPE_WEBHOOK_SECRET are all set (server/validateConfig.js
 * fails startup on a partial configuration). No keys exist in code,
 * no charges can happen without the operator's own Stripe account.
 *
 * New SendSmith code (not part of the MPL-2.0 upstream files).
 */
const config = require('./config');
const users = require('./users');
const log = require('./log')('send.billing');

let stripeClient = null;

function enabled() {
  return !!(
    config.stripe_secret_key &&
    config.stripe_price_id &&
    config.stripe_webhook_secret
  );
}

function getStripe() {
  if (!enabled()) {
    return null;
  }
  if (!stripeClient) {
    // eslint-disable-next-line node/no-missing-require
    stripeClient = require('stripe')(config.stripe_secret_key);
  }
  return stripeClient;
}

async function createCheckoutSession(user) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: config.stripe_price_id, quantity: 1 }],
    client_reference_id: user.id,
    customer_email: user.stripeCustomer ? undefined : user.email,
    customer: user.stripeCustomer || undefined,
    metadata: { userId: user.id },
    subscription_data: { metadata: { userId: user.id } },
    success_url: `${config.base_url}/?billing=success`,
    cancel_url: `${config.base_url}/?billing=cancelled`
  });
  return session;
}

async function createPortalSession(user) {
  const stripe = getStripe();
  if (!user.stripeCustomer) {
    return null;
  }
  return stripe.billingPortal.sessions.create({
    customer: user.stripeCustomer,
    return_url: `${config.base_url}/`
  });
}

async function findUserForEvent(object) {
  const userId =
    (object.metadata && object.metadata.userId) ||
    object.client_reference_id;
  if (userId) {
    return users.getUserById(userId);
  }
  if (object.customer) {
    return users.getUserByStripeCustomer(object.customer);
  }
  return null;
}

// Handles a raw webhook body. Returns an HTTP status code.
async function handleWebhook(rawBody, signature) {
  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe_webhook_secret
    );
  } catch (e) {
    log.error('webhook signature verification failed', e);
    return 400;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const user = await findUserForEvent(session);
        if (user) {
          if (session.customer) {
            await users.linkStripeCustomer(user.id, session.customer);
          }
          await users.setTier(user.id, 'pro');
          log.info('billing: user upgraded to pro', { userId: user.id });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const user = await findUserForEvent(subscription);
        if (user) {
          await users.setTier(user.id, 'free');
          log.info('billing: user downgraded to free', { userId: user.id });
        }
        break;
      }
      default:
        // Other event types are acknowledged and ignored.
        break;
    }
  } catch (e) {
    log.error('webhook handling failed', e);
    return 500;
  }
  return 200;
}

module.exports = {
  enabled,
  getStripe,
  createCheckoutSession,
  createPortalSession,
  handleWebhook
};
