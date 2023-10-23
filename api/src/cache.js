import { createClient } from 'redis';
// import { MongoClient } from 'mongodb';


// import QueueThrottler from './throttler.js';
// const throttler = new QueueThrottler();
 
const createRedisClient = (() => {
    let client;

    return async function getClient() {
        if (!client) {
            client = createClient({ url: 'redis://redis:6379' });
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
    return JSON.parse(cachedResponse);
}

export async function set(key, value) {
    console.log('[redis] set:', key)
    const redisClient = await createRedisClient();
    await redisClient.set(key, JSON.stringify(value));
}   

// export async function myfetch(url, processResponse) {
//     const redisClient = await createRedisClient();
    
//     const cachedResponse = await redisClient.get(url);
//     if (cachedResponse) {
//         return JSON.parse(cachedResponse);
//     }

//     const dataFromDatabase = await getFromDatabase(url);
//     if (dataFromDatabase) {
//         await redisClient.set(url, JSON.stringify(dataFromDatabase));
//         return dataFromDatabase;
//     }

//     console.log('Cache miss: ', url);
//     const response = await throttler.fetch(url);
//     const data = await processResponse(response);
//     await saveToDatabase(url, data);
//     await redisClient.set(url, JSON.stringify(data));
//     return data;
// }


// let cache;

// async function getCache() {
//     if (!cache) {
//         const dbName = 'cache';
//         const collectionName = 'dblp';
//         const mongoURI = process.env.MONGO_URI;
//         const dbClient = new MongoClient(mongoURI);
//         const client = await dbClient.connect();
//         const db = client.db(dbName);
//         cache = db.collection(collectionName);
//     }
//     return cache;   
// }

// async function getFromDatabase(key) {
//     const cache = await getCache();
//     const document = await cache.findOne({ _id: key });
//     return document ? document.value : null;  
// }

// async function saveToDatabase(key, value) {
//     const cache = await getCache();
//     await cache.updateOne({ _id: key }, { $set: { value: value } }, { upsert: true });
// }