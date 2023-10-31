import { createClient } from 'redis';
 
const REDIS_URI = process.env.REDIS_URI;

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
    if (!cachedResponse)
        console.log('[redis] get:', key, '=>', cachedResponse ? '\x1b[32mHIT\x1b[0m' : '\x1b[31mMISS\x1b[0m');
    return JSON.parse(cachedResponse);
}

export async function set(key, value) {
    console.log('\x1b[33m%s\x1b[0m', '[redis] set:', key);
    const redisClient = await createRedisClient();
    await redisClient.set(key, JSON.stringify(value));
}   
