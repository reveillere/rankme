import { MongoClient } from 'mongodb';

const mongoURI = process.env.MONGO_URI;  

let client;

export async function getClient() {
    if (!client) {
        client = new MongoClient(mongoURI);
        await client.connect();
    }
    return client;
}

