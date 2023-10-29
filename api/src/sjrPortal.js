import Papa from 'papaparse';
import fetch from './throttler.js';
import { normalizeTitle, levenshtein } from './levenshtein.js';
import * as cache from './cache.js'
import { getVenueFullName }  from './dblp.js';
import { getClient } from './db.js';

let config = null;

const BASE = 'https://www.scimagojr.com/journalrank.php?out=xls&year=';



        
  
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
        const client = await getClient();
        const db = client.db("scimagojr");

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

async function computeRank(venueFullName, year) {
    try {
        const client = await getClient();
        const db = client.db("scimagojr");

        if (year < config.start) {
            year = config.start;
        }
        if (year > config.end) {
            year = config.end;
        }
        const collection = db.collection(year.toString());
        const documents = (await collection.find({}).toArray()).filter(item => item.Title !== null);
        const titleNormalized = normalizeTitle(venueFullName);
        const result = documents.map(item => {
            const title1 = normalizeTitle(item.Title);
            const distance = levenshtein(title1, titleNormalized);
            return { data: item, distance: distance };
        }).filter(item => item.distance <= 3).sort((a, b) => a.distance - b.distance);

        let response;
        if (result.length > 0) {
            const elt = result[0];
            const rank = elt.data['BestQuartile'];
            if (rank === '-') {
                response = { value: "QU", msg: `No ranking found in scimagojr:${year}` };
            } else
                response = { value: rank, msg: `Best match with "${elt.data.Title}" (distance=${elt.distance})` };
        } else {
            response = { value: "QU", msg: `No ranking found in scimagojr:${year}` };
        }
        return response;
    } catch (error) {
        console.error('Error during levenshtein computation', error);
        return { value: "QU", msg: `No ranking found in scimagojr:${year}` };
    } 
}



export async function controllerRank(req, res) {
    const ref = 'db/journals/' + req.params[0];
    const year = req.query.year;

    if (!year) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters' });
        return;
    }

    try {
        const rank = await getRank(ref, year);
        res.json(rank);
    } catch (error) {
        console.error('Error during rank computation', error);
        res.status(400).json({ error: 'Internal Server Error', message: error.message });
    }
}

async function getRank(ref, year) {
    const key = `rank:${year}:${ref}`;
  
    let rank = await cache.get(key);
    if (rank === null) {
      const venueFullName = await getVenueFullName(ref);
      rank = await computeRank(venueFullName, year);
      cache.set(key, rank);
    }
    return rank;
}
  
export default { load }