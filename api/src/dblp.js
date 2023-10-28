import xml2js from 'xml2js';
import * as cache from './cache.js';
import sax from "sax";

const BASE = 'https://dblp.org';

import QueueThrottler from './throttler.js';
const throttler = new QueueThrottler();

export async function fetchAuthor(req, res) {
    try {
        const authorPID = req.params[0];
        const url = `${BASE}/pid/${authorPID}.xml`;
        const key = `dblp:pid:${authorPID}`;
        let update = false;

        let author = await cache.get(key);
        if (author == null) {
            const resp = await throttler.fetch(url);
            const xmlData = await resp.text();
            const parser = new xml2js.Parser({ explicitArray: false });
            author = await parser.parseStringPromise(xmlData);
            update = true;
        }
        const ensureArray = obj => Array.isArray(obj) ? obj : (obj ? [obj] : []);
        const publications = ensureArray(author?.dblpperson?.r);

        async function processPublication(pub, rankPrefix) {
            const url = pub.url.split('#')[0];
            if (!pub.fullName) {
                pub.fullName = await cache.get(`dblp:venue:${url}`);
                update = true;
            }
            if (!pub.rank) {
                pub.rank = await cache.get(`${rankPrefix}:${pub.fullName}`);
                update = true;
            }
        }
        for (const pub of publications) {
            if (pub.inproceedings) {
                await processPublication(pub.inproceedings, `rank:core:${pub.inproceedings.year}:${pub.inproceedings.booktitle}`);
            } else if (pub.article && pub.article['@']?.publtype  !== 'informal') {
                await processPublication(pub.article, `rank:sjr:${pub.article.year}`);
            }
        }
        
        if (update) {
            await cache.set(key, author);
        }
        res.json(author);
    } catch (error) {
        console.error('Error fetching author:', error);
        res.json([]);
    }
}

export async function searchAuthor(req, res) {
    const { query } = req.params;
    const url = `${BASE}/search/author/api/?format=json&q=${query}`;
    const key = `dblp:search:author/${query}`;

    try {
        let response = await cache.get(key);
        if (response == null) {
            const resp = await throttler.fetch(url);
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
            await cache.set(key, response);
        }
        res.json(response);
    } catch (error) {
        console.error('Error searching author:', error);
        res.json([]);
    }
}



async function searchTitle(url) {
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

        parser.on("closetag", (tag) => {
            if (titleFound && tag === 'h1') {
                if (hasAtSign) {
                    if (beforeAtSignContent && refHref) {
                        resolve({ ref: refHref });
                    } else {
                        resolve({ content: "Full title not available" });
                    }
                } else {
                    if (refHref) {
                        resolve({ ref: refHref });
                    } else {
                        resolve({ content: titleContent.trim() });
                    }
                }
            }
        });

        parser.on("end", () => {
            reject(new Error(`Element not found: ${url}`));
        });

        parser.on("error", (err) => {
            reject(err);
        });

        // Using node-fetch to get the data as stream
        throttler.fetch(url).then(response => {
            if (response.ok) {
                response.body.pipe(parser);
            } else {
                reject(new Error('Failed to fetch URL'));
            }
        }).catch(reject);
    });
}


function parseURL(s) {
    const parts = s.split('/');
    if (parts.length != 4 || parts[0] !== 'db' || (parts[1] !== 'conf' && parts[1] !== 'journals'))
        throw new Error(`Invalid URL: ${s}`);
    return {
        type: parts[1],
        first: parts[2],
        second: parts[3]
    }
}

export async function getVenueTitle(req, res) {
    const processIndirectRef = async (ref) => {
        const url = `${BASE}/${ref.replace(/.html$/, '.xml')}`;
        const key = `dblp:venue:${ref}`;
        let title = await cache.get(key);
        if (title == null) {
            title = await searchTitle(url);
            await cache.set(key, title);
        }
        return title;
    }
    const searchQuery = req.params[0];
    try {
        const key = `dblp:venue:${searchQuery}`;
        let title = await cache.get(key);
        if (title === null) {
            const query = searchQuery.replace(/\d+\.html$/, '');
            const urlParts = parseURL(query);
            title = "";
            if (urlParts.first === urlParts.second) {
                const url = `${BASE}/db/${urlParts.type}/${urlParts.first}/index.xml`;
                title = await searchTitle(url);
                if (title.ref) {
                    title = await processIndirectRef(title.ref);
                }
            } else {
                const url = `${BASE}/${searchQuery.replace(/.html$/, '.xml')}`;
                title = await searchTitle(url);
                if (title.ref) {
                    title = await processIndirectRef(title.ref);
                }
            }
            await cache.set(key, title.content);
            res.json(title.content);
        } else {
            res.json(title);
        }
    } catch (error) {
        console.error('Error fetching conference full name in ', searchQuery);
        res.json("UNKNOWN");
    }
}


