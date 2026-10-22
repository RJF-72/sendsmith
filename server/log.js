const pino = require('pino');
const conf = require('./config');

const isProduction = conf.env === 'production';

// Structured JSON logging via pino (actively maintained, no vendor
// lock-in). This replaces the dead mozlog/intel stack, whose use of the
// removed `util.isError` API prevented the server from booting on
// Node >= 23.
//
// The exported factory keeps the old mozlog call shape —
// `require('./log')('send.upload')` returns a logger whose methods take
// `(eventName, dataOrError)` — so call sites did not need to change.
const base = pino({
  name: 'SendSmith',
  level: isProduction ? 'info' : 'debug'
});

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function adapt(logger) {
  const out = {};
  for (const level of LEVELS) {
    out[level] = function(msg, data) {
      if (data instanceof Error) {
        logger[level]({ err: data }, String(msg));
      } else if (data && typeof data === 'object') {
        logger[level](data, String(msg));
      } else if (data !== undefined) {
        logger[level]({ data }, String(msg));
      } else {
        logger[level](String(msg));
      }
    };
  }
  return out;
}

module.exports = function(component) {
  return adapt(base.child({ component: component || 'send' }));
};

// Exposed for tests and tooling that want the raw pino instance.
module.exports.base = base;
