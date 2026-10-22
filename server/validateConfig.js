/*
 * SendSmith startup configuration validation (fail fast).
 *
 * Convict (server/config.js) already validates types/formats. This
 * module checks the cross-field, environment-specific rules convict
 * cannot express, and exits with a clear message instead of letting
 * the server boot into a silently broken state. Called once from
 * server/bin/prod.js before anything listens.
 *
 * New SendSmith code.
 */
const config = require('./config');

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`\nSendSmith configuration error:\n  ${message}\n`);
  process.exit(1);
}

function validateConfig() {
  if (config.env === 'production') {
    if (config.redis_host === 'mock') {
      fail(
        'NODE_ENV=production but REDIS_HOST=mock. Set REDIS_HOST to a real Redis server — the in-process mock loses all file metadata on restart.'
      );
    }
    if (!config.s3_bucket && !config.gcs_bucket && !process.env.FILE_DIR) {
      fail(
        'NODE_ENV=production but no durable storage is configured. Set S3_BUCKET (recommended), GCS_BUCKET, or an explicit FILE_DIR on persistent disk.'
      );
    }
    if (config.base_url.includes('localhost')) {
      fail(
        `NODE_ENV=production but BASE_URL is ${config.base_url}. Set BASE_URL to the public https:// URL of this deployment — share links and CSP are derived from it.`
      );
    }
  }

  // Turnstile: keys come in pairs; a lone key means a typo'd deploy.
  if (!!config.turnstile_site_key !== !!config.turnstile_secret) {
    fail(
      'TURNSTILE_SITE_KEY and TURNSTILE_SECRET must be set together (or both left unset to disable the bot gate).'
    );
  }

  // Stripe: checkout needs all three values to actually work.
  const stripeParts = [
    config.stripe_secret_key,
    config.stripe_price_id,
    config.stripe_webhook_secret
  ];
  if (stripeParts.some(Boolean) && !stripeParts.every(Boolean)) {
    fail(
      'Partial Stripe configuration: STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET must all be set to enable billing (or all left unset to disable it).'
    );
  }
}

module.exports = { validateConfig };
