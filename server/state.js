const config = require('./config');
const layout = require('./layout');
const assets = require('../common/assets');
const getTranslator = require('./locale');
const users = require('./users');
const billing = require('./billing');

module.exports = async function(req) {
  const locale = req.language || 'en-US';
  let robots = 'none';
  if (req.route && req.route.path === '/') {
    robots = 'all';
  }
  // SendSmith accounts: resolve the session (if any) so server-rendered
  // pages know the visitor's account state, mirroring what the client
  // app will confirm via /api/auth/me.
  let user = null;
  try {
    user = await users.verifyRequest(req);
  } catch (e) {
    // continue without accounts
  }
  const prefs = {};
  if (config.survey_url) {
    prefs.surveyUrl = config.survey_url;
  }
  return {
    archive: {
      numFiles: 0
    },
    locale,
    capabilities: { account: true },
    translate: getTranslator(locale),
    title: 'SendSmith',
    description:
      'SendSmith — encrypted file transfer that self-destructs. Send it. Gone.',
    baseUrl: config.base_url,
    ui: {},
    storage: {
      files: []
    },
    fileInfo: {},
    cspNonce: req.cspNonce,
    user: {
      avatar: assets.get('user.svg'),
      loggedIn: !!user,
      email: user ? user.email : undefined
    },
    robots,
    authConfig: {
      provider: 'sendsmith',
      billingEnabled: billing.enabled(),
      turnstileSiteKey: config.turnstile_site_key || undefined
    },
    prefs,
    layout
  };
};
