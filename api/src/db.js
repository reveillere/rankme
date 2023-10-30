import { MongoClient } from 'mongodb';

const mongoURI = process.env.MONGO_URI;  

let client;

export async function getClient() {
    if (!client) {
        client = new MongoClient(mongoURI);
        if (!client) {
            throw new Error('Unable to connect to MongoDB');
        }
        await client.connect();
    }
    return client;
}

