const assets = require('../../common/assets');
const routes = require('../routes');
const pages = require('../routes/pages');
const tests = require('../../test/frontend/routes');

// NOTE: WebSocket wiring moved to server/wsServer.js (the express-ws
// fork depended on the abandoned `esm` loader). The frontend test
// harness that used this module is not part of the launch test path
// (see docs/UPGRADING.md); attach server/wsServer.js to the http
// server if it is revived.
module.exports = function(app, devServer) {
  assets.setMiddleware(devServer.middleware);
  routes(app);
  tests(app);
  // webpack-dev-server routes haven't been added yet
  // so wait for next tick to add 404 handler
  process.nextTick(() => app.use(pages.notfound));
};
