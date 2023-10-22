import { MongoClient } from 'mongodb';
import Papa from 'papaparse';
import fetch from 'node-fetch';
import { normalizeTitle, levenshtein } from './levenshtein.js';
import * as cache from './cache.js'



let config = null;

const BASE = 'https://www.scimagojr.com/journalrank.php?out=xls&year=';

const mongoURI = process.env.MONGO_URI;
let client;
let db;

async function getDB() {
    if (!client) {
        client = new MongoClient(mongoURI);
        await client.connect();
        db = client.db("scimagojr");
    }
    return db;
}

        
  
async function parseCSV(txt) {
    try {
        const results = await Papa.parse(txt, {
            header: true,
        });

        return results.data.map(item => ({
            'Sourceid': item['Sourceid'],
            'Title': item['Title'],
            'BestQuartile': item['SJR Best Quartile'],
            'Categories': item['Categories'],
            'Areas': item['Areas']
        }));
    } catch (e) {
        console.error('Error during data import: ', e);
        throw e;
    }
}

// Initialize the database
export async function load() {
    console.log('Loading scimagojr database ...');
    try {
        const db = await getDB();

        // Load the configuration parameters
        const collection = db.collection("config");
        const newConfig = { start: 1999, end: 2022 };
        config = await collection.findOne({});
        if (config) {
            await collection.updateOne({}, { $set: newConfig });
        } else {
            config = newConfig
            await collection.insertOne(newConfig);
        }

        for (let year = config.start; year <= config.end; year++) {
            const collectionName = year.toString();
            const collection = db.collection(collectionName);
            const count = await collection.countDocuments();
            if (count === 0) {
                console.log(`Fetching: ${BASE}${year}`);
                const resp = await fetch(`${BASE}${year}`);
                const csvData = await resp.text();
                const jsonObj = await parseCSV(csvData);
                await collection.insertMany(jsonObj);
                console.log(`${jsonObj.length} elements inserted into sjr:${collectionName}.`);
            }
        }
    } catch (error) {
        console.error('Error during connection or insertion:', error);
        throw error;
    }
}

async function getRank(title, year) {
    const key = `sjr:${year}:${title}`;
    try {
        let response = await cache.get(key);
        if (response) {
            return response;
        }
        const db = await getDB();

        if (year < config.start) {
            year = config.start;
        }
        if (year > config.end) {
            year = config.end;
        }
        const collection = db.collection(year.toString());
        const documents = (await collection.find({}).toArray()).filter(item => item.Title !== null);
        const titleNormalized = normalizeTitle(title);
        const result = documents.map(item => {
            const title1 = normalizeTitle(item.Title);
            const distance = levenshtein(title1, titleNormalized);
            return { data: item, distance: distance };
        }).filter(item => item.distance <= 3).sort((a, b) => a.distance - b.distance);

        if (result.length > 0) {
            const elt = result[0];
            response = { value: elt.data['BestQuartile'], msg: `Best match with "${elt.data.Title}" (distance=${elt.distance})` };
        } else {
            response = { value: "QU", msg: `No ranking found in scimagojr:${year}` };
        }
        cache.set(key, response);
        return response;
    } catch (error) {
        console.error('Error during levenshtein computation', error);
        throw error;
    } 
}



export async function controllerRank(req, res) {
    const year = decodeURIComponent(req.query.year);
    const title = decodeURIComponent(req.query.title);

    if (!year || !title) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters year and/or acronym' });
        return;
    }

    const rank = await getRank(title, year);
    res.json(rank);
}

export default { load }