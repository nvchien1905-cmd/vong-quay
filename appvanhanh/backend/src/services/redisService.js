const { Redis } = require('@upstash/redis');

let redis = null;

function getClient() {
  if (redis) return redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

async function cacheGet(key) {
  const client = getClient();
  if (!client) return null;
  try { return await client.get(key); } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 60) {
  const client = getClient();
  if (!client) return;
  try { await client.set(key, value, { ex: ttlSeconds }); } catch {}
}

async function cacheDel(key) {
  const client = getClient();
  if (!client) return;
  try { await client.del(key); } catch {}
}

module.exports = { cacheGet, cacheSet, cacheDel };
