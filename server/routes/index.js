const crypto = require('crypto');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const { UAParser } = require('ua-parser-js');
const storage = require('../storage');
const config = require('../config');
const auth = require('../middleware/auth');
const language = require('../middleware/language');
const ratelimit = require('../middleware/ratelimit');
const pages = require('./pages');
const filelist = require('./filelist');
const authRoutes = require('./auth');
const billingRoutes = require('./billing');
const publicReport = require('./publicReport');
const clientConstants = require('../clientConstants');

const IS_DEV = config.env === 'development';
const ID_REGEX = '([0-9a-fA-F]{10,16})';

module.exports = function(app) {
  app.set('trust proxy', true);
  // CSP is configured explicitly below (production only), so disable
  // helmet's built-in default CSP here — helmet >= 4 enables one by
  // default, which would intersect with and break the nonce policy.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    helmet.hsts({
      maxAge: 31536000,
      includeSubDomains: true
    })
  );
  app.use(function(req, res, next) {
    // ua-parser-js 1.x: UAParser() returns a parser; getResult() gives
    // the {ua, browser, os, ...} shape the rest of the server consumes.
    const parsed = UAParser(req.header('user-agent') || '');
    req.ua = typeof parsed.getResult === 'function' ? parsed.getResult() : parsed;
    next();
  });
  app.use(function(req, res, next) {
    req.cspNonce = crypto.randomBytes(16).toString('hex');
    next();
  });
  if (!IS_DEV) {
    let csp = {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          config.base_url.replace(/^https:\/\//, 'wss://')
        ],
        imgSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          function(req) {
            return `'nonce-${req.cspNonce}'`;
          }
        ],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        reportUri: '/__cspreport__'
      }
    };
    if (config.sentry_id && config.sentry_host) {
      csp.directives.connectSrc.push(config.sentry_host);
    }
    if (config.turnstile_site_key) {
      // The Turnstile widget is loaded from Cloudflare when the bot
      // gate is configured.
      csp.directives.scriptSrc.push('https://challenges.cloudflare.com');
      csp.directives.frameSrc = ['https://challenges.cloudflare.com'];
      csp.directives.connectSrc.push('https://challenges.cloudflare.com');
    }

    app.use(helmet.contentSecurityPolicy(csp));
  }

  app.use(function(req, res, next) {
    res.set('Pragma', 'no-cache');
    res.set(
      'Cache-Control',
      'private, no-cache, no-store, must-revalidate, max-age=0'
    );
    next();
  });
  app.use(function(req, res, next) {
    try {
      // set by the load balancer
      const [country, state] = req.header('X-Client-Geo-Location').split(',');
      req.geo = {
        country,
        state
      };
    } catch (e) {
      req.geo = {};
    }
    next();
  });
  // The Stripe webhook needs the raw request body for signature
  // verification, so it is mounted BEFORE the JSON body parser.
  app.post(
    '/api/billing/webhook',
    bodyParser.raw({ type: 'application/json' }),
    billingRoutes.webhook
  );
  app.use(bodyParser.json());
  app.use(bodyParser.text());
  app.get('/', language, pages.index);
  app.get('/config', function(req, res) {
    res.json(clientConstants);
  });
  app.get('/error', language, pages.blank);
  app.get('/login', language, pages.index);
  app.get('/report', language, pages.blank);
  app.get('/report-abuse', publicReport.page);
  app.get('/app.webmanifest', language, require('./webmanifest'));
  app.get(`/download/:id${ID_REGEX}`, language, pages.download);
  app.get('/unsupported/:reason', language, pages.unsupported);
  app.get(
    `/api/download/token/:id${ID_REGEX}`,
    ratelimit.middleware('download'),
    auth.hmac,
    require('./token')
  );
  app.get(
    `/api/download/:id${ID_REGEX}`,
    ratelimit.middleware('download'),
    auth.dlToken,
    require('./download')
  );
  app.get(
    `/api/download/blob/:id${ID_REGEX}`,
    ratelimit.middleware('download'),
    auth.dlToken,
    require('./download')
  );
  app.post(
    `/api/download/done/:id${ID_REGEX}`,
    auth.dlToken,
    require('./done.js')
  );
  app.get(`/api/exists/:id${ID_REGEX}`, require('./exists'));
  app.get(`/api/metadata/:id${ID_REGEX}`, auth.hmac, require('./metadata'));
  app.get('/api/filelist/:id([\\w-]{16})', auth.session, filelist.get);
  app.post('/api/filelist/:id([\\w-]{16})', auth.session, filelist.post);
  app.post(`/api/delete/:id${ID_REGEX}`, auth.owner, require('./delete'));
  app.post(`/api/password/:id${ID_REGEX}`, auth.owner, require('./password'));
  app.post(`/api/params/:id${ID_REGEX}`, auth.owner, require('./params'));
  app.post(`/api/info/:id${ID_REGEX}`, auth.owner, require('./info'));
  app.post(
    `/api/report/:id${ID_REGEX}`,
    ratelimit.middleware('report'),
    auth.hmac,
    require('./report')
  );
  app.post(
    '/api/public-report',
    ratelimit.middleware('report'),
    publicReport.submit
  );
  // SendSmith accounts + billing (server/users.js, server/billing.js)
  app.post('/api/auth/signup', ratelimit.middleware('auth'), authRoutes.signup);
  app.post('/api/auth/login', ratelimit.middleware('auth'), authRoutes.login);
  app.post('/api/auth/logout', authRoutes.logout);
  app.get('/api/auth/me', authRoutes.me);
  app.post('/api/billing/checkout', billingRoutes.checkout);
  app.get('/api/billing/portal', billingRoutes.portal);
  app.post('/api/metrics', require('./metrics'));
  app.get('/__version__', function(req, res) {
    // eslint-disable-next-line node/no-missing-require
    res.sendFile(require.resolve('../../dist/version.json'));
  });

  app.get('/__lbheartbeat__', function(req, res) {
    res.sendStatus(200);
  });

  app.get('/__heartbeat__', async (req, res) => {
    try {
      await storage.ping();
      res.sendStatus(200);
    } catch (e) {
      res.sendStatus(500);
    }
  });
};
