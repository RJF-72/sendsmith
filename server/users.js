/*
 * SendSmith accounts: email + password users, cookie sessions, tiers
 * and monthly transfer quotas, all stored in Redis.
 *
 * This module replaces the Firefox Accounts (FxA) integration at the
 * seam the upload route already used ("is there a verified user?").
 * Passwords are hashed with scrypt from Node's built-in crypto —
 * no third-party password dependency to abandon us.
 *
 * This file is new SendSmith code (not part of the MPL-2.0 upstream
 * files); it only talks to the storage layer through its public
 * redis facade.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_COOKIE = 'sendsmith_session';

function redis() {
  // Lazy require: server/storage requires config/log only, and several
  // route modules require both storage and users — lazily resolving
  // here keeps the module graph cycle-free.
  return require('./storage').redis;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64')
  ].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    const [, N, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(
      password,
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N: +N, r: +r, p: +p }
    );
    return crypto.timingSafeEqual(derived, expected);
  } catch (e) {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function getUserById(id) {
  if (!id) {
    return null;
  }
  const data = await redis().hgetallAsync(`user:${id}`);
  if (!data) {
    return null;
  }
  return {
    id,
    email: data.email,
    tier: data.tier || 'free',
    stripeCustomer: data.stripe_customer || null,
    created: +data.created || 0
  };
}

async function getUserByEmail(email) {
  const id = await redis().getAsync(`useremail:${normalizeEmail(email)}`);
  return id ? getUserById(id) : null;
}

async function createUser(email, password) {
  email = normalizeEmail(email);
  if (!validEmail(email)) {
    const err = new Error('invalid_email');
    err.code = 'invalid_email';
    throw err;
  }
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('weak_password');
    err.code = 'weak_password';
    throw err;
  }
  const existing = await redis().getAsync(`useremail:${email}`);
  if (existing) {
    const err = new Error('email_taken');
    err.code = 'email_taken';
    throw err;
  }
  const id = crypto.randomBytes(12).toString('hex');
  const passhash = await hashPassword(password);
  await redis().hmsetAsync(`user:${id}`, {
    email,
    passhash,
    tier: 'free',
    created: Date.now()
  });
  await redis().setAsync(`useremail:${email}`, id);
  return getUserById(id);
}

async function authenticate(email, password) {
  const id = await redis().getAsync(
    `useremail:${normalizeEmail(email)}`
  );
  if (!id) {
    return null;
  }
  const data = await redis().hgetallAsync(`user:${id}`);
  if (!data || !(await verifyPassword(password, data.passhash))) {
    return null;
  }
  return getUserById(id);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await redis().setAsync(`session:${token}`, userId);
  await redis().expireAsync(`session:${token}`, config.session_ttl_seconds);
  return token;
}

async function getUserBySession(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const userId = await redis().getAsync(`session:${token}`);
  return userId ? getUserById(userId) : null;
}

async function destroySession(token) {
  if (token) {
    await redis().delAsync(`session:${token}`);
  }
}

async function setTier(userId, tier) {
  await redis().hsetAsync(`user:${userId}`, 'tier', tier);
  return getUserById(userId);
}

async function setStripeCustomer(userId, customerId) {
  await redis().hsetAsync(`user:${userId}`, 'stripe_customer', customerId);
  return getUserById(userId);
}

async function getUserByStripeCustomer(customerId) {
  const id = await redis().getAsync(`stripecustomer:${customerId}`);
  return id ? getUserById(id) : null;
}

async function linkStripeCustomer(userId, customerId) {
  await redis().setAsync(`stripecustomer:${customerId}`, userId);
  return setStripeCustomer(userId, customerId);
}

// --- Monthly transfer quota (bytes uploaded per calendar month, UTC) ---

function usageKey(userId, date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `usage:${userId}:${y}-${m}`;
}

function quotaLimitFor(user) {
  if (!user) {
    return 0;
  }
  return user.tier === 'pro'
    ? config.pro_monthly_quota_bytes
    : config.free_monthly_quota_bytes;
}

async function getUsage(userId) {
  const value = await redis().getAsync(usageKey(userId));
  return value ? parseInt(value, 10) || 0 : 0;
}

async function checkQuota(user) {
  const limit = quotaLimitFor(user);
  const usage = await getUsage(user.id);
  // limit <= 0 means "no quota" (operator-configured unlimited)
  return { usage, limit, ok: limit <= 0 || usage < limit };
}

async function addUsage(userId, bytes) {
  if (!bytes || bytes <= 0) {
    return;
  }
  const key = usageKey(userId);
  await redis().incrbyAsync(key, bytes);
  // Keep the counter for a bit past month end for support/debugging.
  await redis().expireAsync(key, 40 * 86400);
}

// --- Request helpers ---

function sessionTokenFromRequest(req, fallbackToken) {
  const cookieHeader =
    (req.headers && req.headers.cookie) ||
    (req.header && req.header('cookie'));
  if (cookieHeader) {
    for (const part of String(cookieHeader).split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  const authHeader =
    (req.headers && req.headers.authorization) ||
    (req.header && req.header('Authorization'));
  if (authHeader && /^Bearer\s/i.test(authHeader)) {
    return authHeader.split(/\s+/)[1];
  }
  return fallbackToken || null;
}

async function verifyRequest(req, fallbackToken) {
  const token = sessionTokenFromRequest(req, fallbackToken);
  return token ? getUserBySession(token) : null;
}

function sessionCookie(token, { secure } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${config.session_ttl_seconds}`
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearSessionCookie({ secure } = {}) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  validEmail,
  normalizeEmail,
  createUser,
  authenticate,
  getUserById,
  getUserByEmail,
  createSession,
  getUserBySession,
  destroySession,
  setTier,
  setStripeCustomer,
  getUserByStripeCustomer,
  linkStripeCustomer,
  quotaLimitFor,
  getUsage,
  checkQuota,
  addUsage,
  usageKey,
  sessionTokenFromRequest,
  verifyRequest,
  sessionCookie,
  clearSessionCookie
};
