import { MongoClient } from 'mongodb';

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017';  

let client;

export async function getClient() {
    if (!client) {
        client = new MongoClient(mongoURI);
        await client.connect();
    }
    return client;
}

