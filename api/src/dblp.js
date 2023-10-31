import xml2js from 'xml2js';
import * as cache from './cache.js';
import sax from "sax";
import { getClient } from './db.js';

const BASE = 'https://dblp.org';

import fetch from './throttler.js';

const ensureArray = obj => Array.isArray(obj) ? obj : (obj ? [obj] : []);


export async function updateAuthor(author) {
    let update = 0;
    const publications = ensureArray(author?.dblpperson?.r);

    async function processPublication(pub) {
        const url = pub.url.split('#')[0];
        if (!pub.fullName) {
            const key = `dblp:venue:${url}`;
            pub.fullName = await cache.get(key); 
            if (pub.fullName)
                update++
        }
        if (!pub.rank) {
            const key = `rank:${pub.year}:${url}`;
            pub.rank = await cache.get(key); 
            if (pub.rank)
                update++
        }
    }

    for (const pub of publications) {
        if (pub.inproceedings) {
            await processPublication(pub.inproceedings);
        } else if (pub.article && pub.article['$']?.publtype !== 'informal') {
            await processPublication(pub.article);
        }
    }
    return update;
}

export async function controllerAuthor(req, res) {
    const authorPID = req.params[0];
    try {
        const author = await getFetchAuthor(authorPID);
        res.json(author);
    } catch (error) {
        console.log('Error during author computation', error);
        res.status(400).json({ error: error.message })
    }
}

export async function getFetchAuthor(authorPID) {
    const key = `dblp:pid:${authorPID}`;

    let author = await cache.get(key);
    if (author == null) {
        author = await getAuthor(authorPID, key);
        cache.set(key, author); 
    }

    const updates = await updateAuthor(author);
    if (updates > 0)
        cache.set(key, author); 
    return author
}

async function getAuthor(authorPID, key) {
    const url = `${BASE}/pid/${authorPID}.xml`;
    const resp = await fetch(url);
    const xmlData = await resp.text();
    const parser = new xml2js.Parser({ explicitArray: false });
    return await parser.parseStringPromise(xmlData);
}

// ****************************************************************************************************
// ****************************************************************************************************

export async function controllerSearch(req, res) {
    const searchQuery = req.params[0];
    try {
        const author = await getSearchAuthor(searchQuery);
        res.json(author);
    } catch (error) {
        console.log('Error during search computation', error);
        res.status(400).json({ error: error.message })
    }
}

async function getSearchAuthor(searchQuery) {
    const key = `dblp:search:${searchQuery}`;

    let results = await cache.get(key);
    if (results == null) {
        console.log(`Search: [${searchQuery}]`)
        const exactMatches = await searchAuthor(searchQuery.replace(/ +/g, '$ ') + '$');
        const likelyMatches = await searchAuthor(searchQuery);
        const combined = exactMatches.concat(likelyMatches);
        results = combined.filter((value, index, self) => 
            self.findIndex(item => item.pid === value.pid) === index
        );        cache.set(key, results); 
    }
    return results
}

export async function searchAuthor(searchQuery) {
    const url = `${BASE}/search/author/api/?format=json&q=${searchQuery}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const hits = data.result.hits;

    if (hits['@total'] === "0") {   
        return [];
    } else {
        const affiliations = jsonData => {
            return ensureArray(jsonData.info?.notes?.note)
                .filter(note => note["@type"] === "affiliation")
                .map(note => note.text);
        }
        const prefix = `${BASE}/pid/`;
        const pid = url => url.substring(prefix.length);
        return await hits.hit.map(hit => ({
            author: hit.info.author,
            pid: pid(hit.info.url),
            affiliation: affiliations(hit),
        }));
    }
}





// ****************************************************************************************************
// ****************************************************************************************************


export async function searchTitle(ref) {
    return new Promise((resolve, reject) => {
        const parser = sax.createStream(true);
        let titleFound = false;
        let titleContent = '';
        let refHref = '';
        let hasAtSign = false;
        let beforeAtSignContent = '';

        parser.on("opentag", (node) => {
            if (node.name === 'h1') {
                titleFound = true;
            }
            if (titleFound && node.name === 'ref' && node.attributes && node.attributes.href) {
                if (!hasAtSign && !refHref) {
                    refHref = node.attributes.href;
                }
            }
        });

        parser.on("text", (text) => {
            if (titleFound) {
                titleContent += text;
                if (text.includes('@')) {
                    hasAtSign = true;
                }
                if (!hasAtSign) {
                    beforeAtSignContent += text.trim();
                }
            }
        });

        parser.on("closetag", async (tag) => {
            if (titleFound && tag === 'h1') {        
                // If there's an @ symbol in the h1 content and we have a refHref, fetch the full title
                if (hasAtSign && beforeAtSignContent && refHref) {
                    try {
                        const title = await getVenueFullName(refHref);
                        resolve(title);
                    } catch (err) {
                        reject(err);
                    }
                }
                // If there's no @ symbol but we have a refHref, fetch the full title
                else if (refHref) {
                    try {
                        const title = await getVenueFullName(refHref);
                        resolve(title);
                    } catch (err) {
                        reject(err);
                    }
                }
                // If none of the above conditions are met, just resolve with the h1 content
                else {
                    resolve(titleContent.trim());
                }
            }
        });

        parser.on("end", () => {
            if (!titleFound)
                reject(new Error(`Element not found: ${url}`));
        });
 
        parser.on("error", (err) => {
            reject(err); 
        });

        // Using node-fetch to get the data as stream
        const url = `${BASE}/${ref.replace(/\.html$/, ".xml")}`;
        fetch(url).then(response => {
            if (response.ok) {
                response.body.pipe(parser);
            } else {
                reject(new Error(`Failed to fetch ${url}`));
            }
        }).catch(reject);
    });
}


export async function getVenueFullName(ref) {
    const key = `dblp:venue:${ref}`;

    const client = await getClient();
    const db = client.db("dblp");
    const venues = db.collection('venues');

    let title = await cache.get(key);
    if (title == null) {
        try {
            const doc = await venues.findOne({ 'url': ref });
            if (doc) {
                // console.log(`[Venue] get: ${ref} => \x1b[32mHIT\x1b[0m`);
                title = doc.venue;
            } else {
                console.log(`[Venue] get: ${ref} => \x1b[31mMISS\x1b[0m`);
                title = await searchTitle(ref);
                if (title) {
                    await venues.insertOne({ 'url': ref, 'venue': title });
                    console.log(`\x1b[34m[Venue] set:\x1b[0m ${ref}`);
                }
            }
        } catch (err) {
            console.log(`\x1b[34m[Venues]\x1b[0m Error in venue lookup ${err} ...`);
            title = "";
        }
        cache.set(key, title); 
    }

    return title;
}



export async function controllerVenue(req, res) {
    const ref = req.params[0]; 

    if (!ref) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing query parameter ref' });
        return;
    }

    try {
        const title = await getVenueFullName(ref);
        res.json(title);
    } catch (error) {
        console.log('Error during venue title computation of ', ref, " ", error);
        res.status(400).json({ error: error.message })
    }
}