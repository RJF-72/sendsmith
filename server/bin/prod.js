const express = require('express');
const http = require('http');
const path = require('path');
const Sentry = require('@sentry/node');
const config = require('../config');
const { validateConfig } = require('../validateConfig');
const routes = require('../routes');
const pages = require('../routes/pages');
const attachWs = require('../wsServer');

// Fail fast on missing/invalid required configuration instead of
// booting into a silently broken state (see server/validateConfig.js).
validateConfig();

// Sentry is strictly opt-in: nothing is sent anywhere unless the
// operator sets SENTRY_DSN for their own Sentry instance.
if (config.sentry_dsn) {
  Sentry.init({ dsn: config.sentry_dsn });
}

const app = express();

routes(app);

app.use(
  express.static(path.resolve(__dirname, '../../dist/'), {
    setHeaders: function(res, path) {
      if (!/serviceWorker\.js$/.test(path)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      res.removeHeader('Pragma');
    }
  })
);

app.use(pages.notfound);

const httpServer = http.createServer(app);
attachWs(httpServer);
httpServer.listen(config.listen_port, config.listen_address);
