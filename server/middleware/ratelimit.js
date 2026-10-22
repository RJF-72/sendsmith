/*
 * SendSmith rate limiting: Redis-backed fixed-window counters,
 * shared by the HTTP middleware below and the WebSocket upload route
 * (which is not an Express middleware chain).
 *
 * New SendSmith code. Keys look like: rl:<name>:<ip>:<windowStart>
 */
const config = require('../config');

function redis() {
  return require('../storage').redis;
}

function clientIp(req) {
  const ip =
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown';
  return String(ip).replace(/^::ffff:/, '');
}

async function check(key, { windowSeconds, max }) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const redisKey = `rl:${key}:${windowStart}`;
  const count = await redis().incrbyAsync(redisKey, 1);
  if (count === 1) {
    await redis().expireAsync(redisKey, windowSeconds);
  }
  return {
    allowed: count <= max,
    count,
    retryAfter: Math.max(1, windowStart + windowSeconds - now)
  };
}

function limitsFor(name) {
  return {
    windowSeconds: config[`ratelimit_${name}_window_seconds`] || 3600,
    max: config[`ratelimit_${name}_max`] || 60
  };
}

async function checkNamed(name, req) {
  return check(`${name}:${clientIp(req)}`, limitsFor(name));
}

// Express middleware factory. Responds 429 with a JSON error and a
// Retry-After header when the caller is over the limit.
function middleware(name) {
  return async function(req, res, next) {
    try {
      const result = await checkNamed(name, req);
      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfter));
        return res.status(429).json({ error: 'rate_limited' });
      }
      next();
    } catch (e) {
      // Rate limiting must never take the service down with it:
      // if Redis hiccups, fail open and let the request through.
      next();
    }
  };
}

module.exports = { check, checkNamed, middleware, clientIp };
