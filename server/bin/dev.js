const assets = require('../../common/assets');
const routes = require('../routes');
const pages = require('../routes/pages');
const tests = require('../../test/frontend/routes');
const express = require('express');
const http = require('http');
const attachWs = require('../wsServer');
const morgan = require('morgan');
const config = require('../config');

module.exports = function(app, devServer) {
  const wsapp = express();
  routes(wsapp);
  const wsHttpServer = http.createServer(wsapp);
  attachWs(wsHttpServer);
  wsHttpServer.listen(1338, config.listen_address);

  // webpack-dev-middleware v7 moved the output fs to
  // middleware.context.outputFileSystem; common/assets.js expects the
  // v3-era shape, so adapt here. (The Android shell routes that also
  // lived here were removed with the native shells — see
  // docs/UPGRADING.md.)
  const middleware = devServer.middleware;
  if (middleware && !middleware.fileSystem && middleware.context) {
    middleware.fileSystem = middleware.context.outputFileSystem;
  }
  assets.setMiddleware(middleware);
  app.use(morgan('dev', { stream: process.stderr }));
  routes(app);
  tests(app);
  // webpack-dev-server routes haven't been added yet
  // so wait for next tick to add 404 handler
  process.nextTick(() => app.use(pages.notfound));
};
