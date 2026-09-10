import { createClient } from 'redis';

const REDIS_URI = process.env.REDIS_URI;

// A get/HIT-or-MISS line on every single cache.get was ~90% of this
// container's total log volume (756k of 862k lines over 25h uptime) for no
// production benefit -- default off, opt in for local debugging.
const DEBUG_CACHE = process.env.DEBUG_CACHE === 'true';

const createRedisClient = (() => {
    let client;

    return async function getClient() {
        if (!client) {
            client = createClient({ url: REDIS_URI });
            client.on('error', err => {
                console.log('Redis Client Error', err);
                // Reset client if you want to handle reconnection on next call
                client = null;
            });
            await client.connect();
        }
        return client;
    };
})();

export async function get(key) {
    const redisClient = await createRedisClient();
    const cachedResponse = await redisClient.get(key);
    if (DEBUG_CACHE) {
        console.log('[redis] get:', key, '=>', cachedResponse ? '\x1b[32mHIT\x1b[0m' : '\x1b[31mMISS\x1b[0m');
    }
    return JSON.parse(cachedResponse);
}

// Batch read: one round-trip for many keys instead of one per key. Returns
// a Map holding only the keys that were actually a HIT (parsed) -- a MISS
// key is simply absent, same "absent means miss" contract callers already
// get from a bare `get()` returning null, without forcing every caller to
// distinguish "null" (missing) from a legitimately cached null-ish value.
// Empty input short-circuits before touching Redis at all, since mGet on an
// empty array isn't guaranteed to make sense across all clients/versions.
export async function mget(keys) {
    const result = new Map();
    if (keys.length === 0) return result;
    const redisClient = await createRedisClient();
    const values = await redisClient.mGet(keys);
    for (let i = 0; i < keys.length; i++) {
        if (values[i] !== null) result.set(keys[i], JSON.parse(values[i]));
    }
    if (DEBUG_CACHE) {
        console.log('[redis] mget:', keys.length, 'keys =>', result.size, 'hits');
    }
    return result;
}

// Caching is best-effort: callers frequently fire this without awaiting it,
// so a Redis error here must never surface as an unhandled rejection and
// crash the process.
export async function set(key, value, ttl = null) {
    try {
        const redisClient = await createRedisClient();

        if (ttl) {
            console.log('\x1b[33m%s\x1b[0m', '[redis] set:', key, 'with TTL = ', ttl);
            await redisClient.set(key, JSON.stringify(value), { 'EX': ttl });
        } else {
            console.log('\x1b[33m%s\x1b[0m', '[redis] set:', key);
            await redisClient.set(key, JSON.stringify(value));
        }
    } catch (error) {
        console.error('[redis] set failed for key', key, ':', error.message);
    }
}

// For the admin dashboard: a quick health snapshot via the same singleton
// client, rather than opening a separate connection.
export async function status() {
    try {
        const redisClient = await createRedisClient();
        const [pong, dbsize, info] = await Promise.all([
            redisClient.ping(),
            redisClient.dbSize(),
            redisClient.info('memory'),
        ]);
        const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1]?.trim() ?? null;
        return { ok: pong === 'PONG', dbsize, usedMemory };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}
