import { MongoClient } from 'mongodb';
import Papa from 'papaparse';
import fetch from 'node-fetch';
import fs from 'fs';
import { normalizeTitle, levenshtein } from './levenshtein.js';


const URI = "mongodb://mongo:27017";
const client = new MongoClient(URI);

const BASE = 'https://www.scimagojr.com/journalrank.php?out=xls&year=';
const DATA_DIR = '/app/data/scimagojr';

async function fetchCSV(year) {
    const DATA_FILE_PATH = `${DATA_DIR}/${year}.csv`;

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    try {
        const data = await fs.promises.readFile(DATA_FILE_PATH, 'utf8');
        return data;
    } catch (error) {
        const resp = await fetch(`${BASE}${year}`);
        const text = await resp.text();

        await fs.promises.writeFile(DATA_FILE_PATH, text, 'utf8');
        return text;
    }
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


export async function load() {
    try {
        await client.connect();
        const db = client.db("scimagojr");
        for (let year = 1999; year <= 2022; year++) {
            const collectionName = year.toString();
            const collection = db.collection(collectionName);
            const count = await collection.countDocuments();
            if (count > 0) {
                console.log(`Collection scimagojr:${collectionName} already exists, skipping.`);
            } else {
                const csvData = await fetchCSV(year);
                const jsonObj = await parseCSV(csvData);
                await collection.insertMany(jsonObj);
                console.log(`${jsonObj.length} elements inserted into the  scimagojr${collectionName}.`);
            }
        }
    } catch (error) {
        console.error('Error during connection or insertion:', error);
        throw error;
    } finally {
        await client.close();
    }
}

async function getRank(title, year) {
    const titleNormalized = normalizeTitle(title);
    try {
        await client.connect();
        const db = client.db("scimagojr");
        if (year < 1999) {
            year = 1999;
        }
        if (year > 2022) {
            year = 2022;
        }
        const collection = db.collection(year.toString());
        const documents = (await collection.find({}).toArray()).filter(item => item.Title !== null);
        const result = documents.map(item => {
            const title1 = normalizeTitle(item.Title);
            const distance = levenshtein(title1, titleNormalized);
            return { data: item, distance: distance };
        }).filter(item => item.distance <= 3).sort((a, b) => a.distance - b.distance);

        if (result.length > 0) {
            const elt = result[0];
            return { value: elt.data['BestQuartile'], msg: `Best match with "${elt.data.Title}" (distance=${elt.distance})` };
        }

        return { value: "Unranked", msg: `No ranking found in scimagojr:${year}` };

    } catch (error) {
        console.error('Error during levenshtein computation', error);
        throw error;
    } finally {
        await client.close();
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