const { WebSocketServer } = require('ws');
const log = require('./log')('wsServer');
const uploadHandler = require('./routes/ws');

// Replaces the abandoned @dannycoates/express-ws fork (which pulled in
// the unmaintained `esm` loader and crashes on modern Node) with a
// small owned wiring on top of the standard `ws` package: HTTP upgrade
// requests for /api/ws are handed to the upload route with the same
// (ws, req) signature express-ws provided. Everything else is refused.
module.exports = function attachWs(httpServer) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = null;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (e) {
      pathname = null;
    }
    if (pathname === '/api/ws') {
      // express-ws ran the upgrade request through the express
      // pipeline, which decorates req; reproduce the few decorations
      // the upload handler relies on:
      // - req.ip (honoring trust proxy is the operator's reverse-proxy
      //   concern; the raw address is the most we can know here)
      if (!req.ip) {
        req.ip =
          (req.socket && req.socket.remoteAddress) ||
          (req.connection && req.connection.remoteAddress);
      }
      // - req.get(name): express's header accessor
      if (typeof req.get !== 'function') {
        req.get = name => req.headers[String(name).toLowerCase()];
      }
      // - req.geo: set by the geo middleware for regular requests;
      //   only used for optional upload telemetry
      if (!req.geo) {
        req.geo = {};
      }
      // - req.protocol: express derives it from the connection /
      //   X-Forwarded-Proto; the upload response URL is built from it
      if (!req.protocol) {
        const forwarded = req.headers['x-forwarded-proto'];
        req.protocol =
          (forwarded && String(forwarded).split(',')[0].trim()) ||
          (req.socket && req.socket.encrypted ? 'https' : 'http');
      }
      wss.handleUpgrade(req, socket, head, ws => {
        // The upload route is a plain (ws, req) handler (it registers
        // its own ws event listeners); invoke it defensively so a
        // synchronous throw can never take the server down.
        Promise.resolve()
          .then(() => uploadHandler(ws, req))
          .catch(err => {
            log.error('ws_handler_error', err);
            try {
              ws.terminate();
            } catch (e) {
              // already gone
            }
          });
      });
    } else {
      socket.destroy();
    }
  });
  return wss;
};
