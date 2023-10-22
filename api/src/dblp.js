import xml2js from 'xml2js';
import * as cache from './cache.js';

const BASE = 'https://dblp.org'; 

export async function fetchAuthor(req, res) {
    try {
        const authorPID = req.params[0];
        const url = `${BASE}/pid/${authorPID}.xml`;

        let response = await cache.get(url);
        if (response == null) {
            const resp = await fetch(url);
            const xmlData = await resp.text();
            const parser = new xml2js.Parser({ explicitArray: false });
            response = await parser.parseStringPromise(xmlData);
        }
        cache.set(url, response);
        res.json(response);
    } catch (error) {
        console.error('Error fetching author:', error);
        res.json([]);
    }
}



export async function searchAuthor(req, res) {
    const { query } = req.params;
    const url = `${BASE}/search/author/api/?format=json&q=${query}`;

    try {
        let response = await cache.get(url);
        if (response == null) {
            const resp = await fetch(url);
            const data = await resp.json();
            const hits = data.result.hits;

            if (hits['@total'] === "0") {
                return [];
            } else {
                const affiliations = jsonData => {
                    const note = jsonData.info?.notes?.note;
                    if (note && note["@type"] === "affiliation")
                        return note.text;
                    else return '';
                }
                const prefix = `${BASE}/pid/`;
                const pid = url => url.substring(prefix.length);
                response = await hits.hit.map(hit => ({
                    author: hit.info.author,
                    pid: pid(hit.info.url),
                    affiliation: affiliations(hit),
                }));
            }
        }
        cache.set(url, response);
        res.json(response);
    } catch (error) {
        console.error('Error searching author:', error);
        res.json([]);
    }
}


export async function getVenueTitle(req, res) {
    let url = req.params[0];
    url = `${BASE}/` + url.replace(/\/[^/]+\.html$/, "/index.xml");

    try {
        let response = await cache.get(url);
        if (response == null) {
            const resp = await fetch(url);
            const xmlData = await resp.text();
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(xmlData);
            response = result?.bht?.h1;
        }
        cache.set(url, response);
        res.json(response);
    } catch (error) {
        console.error('Error fetching conference full name:', error);
        res.json("");
    }
} 

