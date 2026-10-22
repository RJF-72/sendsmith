/*
 * SendSmith bot gate: optional Cloudflare Turnstile verification for
 * uploads. Implemented as a seam — when TURNSTILE_SECRET is not set
 * the gate is disabled and every check passes (the rest of the abuse
 * stack, rate limits + tighter anon limits, still applies).
 *
 * When the secret IS set, uploads must present a Turnstile token
 * (the web client sends it as `botToken` in the first WebSocket
 * message after completing the widget rendered with
 * TURNSTILE_SITE_KEY). Verification uses the standard Cloudflare
 * siteverify endpoint via native fetch.
 *
 * New SendSmith code.
 */
const config = require('../config');
const log = require('../log')('send.botgate');

function enabled() {
  return !!config.turnstile_secret;
}

async function verify(token, ip) {
  if (!enabled()) {
    return true;
  }
  if (!token || typeof token !== 'string') {
    return false;
  }
  try {
    const body = new URLSearchParams({
      secret: config.turnstile_secret,
      response: token
    });
    if (ip) {
      body.set('remoteip', ip);
    }
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5000)
      }
    );
    const result = await res.json();
    return result.success === true;
  } catch (e) {
    log.error('turnstile verify failed', e);
    return false;
  }
}

module.exports = { enabled, verify };
