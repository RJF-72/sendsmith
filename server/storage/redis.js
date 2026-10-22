const promisify = require('util').promisify;

// Creates the Redis client used by the storage layer.
//
// Modernized from node-redis v3 (callback API) to node-redis v5
// (native promises). Both branches return a client augmented with the
// `*Async` facade the storage layer was written against
// (ttlAsync, hgetallAsync, hgetAsync, hincrbyAsync, hmgetAsync,
// pingAsync, existsAsync, ...) plus the few bare command aliases
// (hset/hmset/expire/del) that server/storage/index.js calls directly.
//
// New code should prefer the *Async facade or the client's native
// promise commands; the facade keeps every pre-existing call site and
// test working unchanged.
module.exports = function(config) {
  if (config.env === 'development' && config.redis_host === 'mock') {
    // In-process mock used for local dev and the backend test suite.
    // redis-mock speaks the callback API, so promisify like the old code.
    const redisMock = require('redis-mock');
    const client = redisMock.createClient();
    client.ttlAsync = promisify(client.ttl);
    const hgetallBound = promisify(client.hgetall.bind(client));
    client.hgetallAsync = async (...args) => {
      const result = await hgetallBound(...args);
      // node-redis v3 returned null for a missing key; redis-mock and
      // v5 return {}. Normalize to null so "no metadata" checks work
      // the same on every backend.
      return result && Object.keys(result).length ? result : null;
    };
    client.hgetAsync = promisify(client.hget);
    client.hincrbyAsync = promisify(client.hincrby);
    client.hmgetAsync = promisify(client.hmget);
    client.pingAsync = promisify(client.ping);
    client.existsAsync = promisify(client.exists);
    client.getAsync = promisify(client.get);
    client.setAsync = promisify(client.set);
    client.delAsync = promisify(client.del);
    client.expireAsync = promisify(client.expire);
    client.incrbyAsync = promisify(client.incrby);
    client.lpushAsync = promisify(client.lpush);
    client.hsetAsync = promisify(client.hset);
    client.hmsetAsync = promisify(client.hmset);
    client.lrangeAsync = promisify(client.lrange);
    return client;
  }

  const { createClient } = require('redis');
  const client = createClient({
    socket: {
      host: config.redis_host,
      port: config.redis_port || 6379,
      reconnectStrategy: retries =>
        Math.min(retries * (config.redis_retry_delay || 500), 3000)
    },
    password: config.redis_password || undefined
  });

  // *Async facade over the native promise commands.
  client.ttlAsync = (...args) => client.ttl(...args);
  client.hgetallAsync = async (...args) => {
    const result = await client.hGetAll(...args);
    return result && Object.keys(result).length ? result : null;
  };
  client.hgetAsync = (...args) => client.hGet(...args);
  client.hincrbyAsync = (...args) => client.hIncrBy(...args);
  client.hmgetAsync = (...args) => client.hMGet(...args);
  client.pingAsync = (...args) => client.ping(...args);
  client.existsAsync = (...args) => client.exists(...args);
  client.getAsync = (...args) => client.get(...args);
  client.setAsync = (...args) => client.set(...args);
  client.delAsync = (...args) => client.del(...args);
  client.expireAsync = (...args) => client.expire(...args);
  client.incrbyAsync = (...args) => client.incrBy(...args);
  client.lpushAsync = (...args) => client.lPush(...args);
  client.hsetAsync = (...args) => client.hSet(...args);
  client.hmsetAsync = (key, obj) => client.hSet(key, obj);
  client.lrangeAsync = (...args) => client.lRange(...args);

  // Bare aliases used by server/storage/index.js (written against the
  // v3 client). HSET accepts the same (key, field, value) and
  // (key, object) shapes upstream called via hset/hmset.
  const hSet = client.hSet.bind(client);
  client.hset = (...args) => hSet(...args);
  client.hmset = (...args) => hSet(...args);

  client.connect().catch(err => {
    client.emit('error', err);
  });
  return client;
};
