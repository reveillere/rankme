import { MongoClient } from 'mongodb';

const mongoURI = process.env.MONGO_URI;
let client;

export async function getClient() {
    if (!client) {
        client = new MongoClient(mongoURI);
        client = await client.connect();
    }
    return client;
}

