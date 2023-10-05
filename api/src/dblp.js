import xml2js from 'xml2js';
import QueueThrottler from './throttler.js';
import NodeCache from 'node-cache';

export const BASE = 'https://dblp.org';

const throttler = new QueueThrottler();

// TTL = 1 days, checkperiod = 1 hour
const dblpDB = new NodeCache({ stdTTL: 60 * 60 * 24 * 1, checkperiod: 60 * 60 });

// DBLP API
 
export async function fetchAuthor(req, res) {
    try {
        const authorPID = req.params[0];
        const url = `${BASE}/pid/${authorPID}.xml`;

        const data = dblpDB.get(url);
        if (data != undefined) {
            res.json(data);
            return;
        }

        // Make an HTTP request to the DBLP API using fetch
        const response = await throttler.fetch(url);

        // Check if the response status is OK (200)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // Parse the XML response
        const xmlData = await response.text();
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        dblpDB.set(url, result);
        res.json(result);
    } catch (error) {
        console.error('Error fetching author:', error);
        return [];
    }
}



export async function searchAuthor(req, res) {

    const affiliations = jsonData => {
        const note = jsonData.info?.notes?.note;
        if (note && note["@type"] === "affiliation")
            return note.text;
        else return '';
    }
    const { query } = req.params;
    const url = `${BASE}/search/author/api/?format=json&q=${query}`;

    const data = dblpDB.get(url);
    if (data != undefined) {
        res.json(data);
        return;
    }

    const prefix = `${BASE}/pid/`;
    const pid = url => url.substring(prefix.length);
    try {
        const response = await throttler.fetch(url);
        const data = await response.json();
        const hits = data.result.hits;

        if (hits['@total'] === "0") {
            res.json([]);
        } else {

            const json = await hits.hit.map(hit => ({
                author: hit.info.author,
                pid: pid(hit.info.url),
                affiliation: affiliations(hit),
            }));

            dblpDB.set(url, json);
            res.json(json);
        }
    } catch (error) {
        console.error('Error searching author:', error);
        return [];
    }
}


export async function getVenueTitle(req, res) {
    let url = req.params[0];
    url = url.replace(/\/[^/]+\.html$/, "/index.xml");

    const data = dblpDB.get(url);
    if (data != undefined) {
        res.json(data);
        return;
    }
    try {
        // Make an HTTP request to the DBLP API using fetch
        const response = await throttler.fetch(`${BASE}/${url}`);

        // Check if the response status is OK (200)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // Parse the XML response
        const xmlData = await response.text();
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);
        const h1 = result?.bht?.h1;
        dblpDB.set(url, h1);
        res.json(h1);
    } catch (error) {
        console.error('Error fetching conference full name:', error);
        res.json("");
    }
} 



