import fetch from 'node-fetch';
import crypto from 'crypto'; // used for both the DBLP dump MD5 check and the admin token below
import { pipeline } from 'stream';
import gunzip from 'gunzip-maybe';
import { createWriteStream, statSync, createReadStream } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import sax from 'sax';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from './db.js';
import { getVenueFullName } from './dblp.js';
import * as cache from './cache.js';
import * as metrics from './metrics.js';
import * as throttler from './throttler.js';
import * as ranking from './ranking.js';
import * as activeStreams from './activeStreams.js';

const DBLP_XML_URL = 'https://dblp.org/xml/dblp.xml.gz';
const DBLP_MD5_URL = 'https://dblp.org/xml/dblp.xml.gz.md5';

function printProgress(msg = 'Progression') {
    let lastLoggedPercentage = -1; 
    return function(current, total) {
        const percentage = ((current / total) * 100).toFixed(0);
        if (percentage % 1 === 0 && percentage !== lastLoggedPercentage) {
            lastLoggedPercentage = percentage;
            console.log(`${msg}: ${percentage}%`);
        }
    }
}

const downloadFile = async () => {
    const response = await fetch(DBLP_XML_URL);
    const totalSize = Number(response.headers.get('content-length'));
    let downloadedSize = 0;

    const writer = createWriteStream('/data/dblp/dblp.xml.gz');
    const pp = printProgress('Download');
    await new Promise((resolve, reject) => {
        response.body.on('data', (chunk) => {
            downloadedSize += chunk.length;
            pp(downloadedSize, totalSize);
        });

        pipeline(response.body, writer, (err) => {
            if (err) reject(err);
            else {
                console.log('\nDownload completed!');
                resolve();
            }
        });
    });
};

const MD5_PATTERN = /^[0-9a-f]{32}$/i;

const getCurrentMD5 = async () => {
    const md5Response = await fetch(DBLP_MD5_URL);
    const md5Content = await md5Response.text();
    const md5Expected = md5Content.trim().split(/\s+/)[0];
    // dblp.org currently sits behind Anubis anti-bot protection, which
    // answers plain HTTP clients (this fetch included) with a JS challenge
    // page instead of the real .md5 file -- that response is still a 200,
    // so without this check a challenge page's opening token would be
    // silently treated as "the new hash", triggering a doomed re-download
    // that overwrites a perfectly good local dump with garbage mid-way
    // through (see extractVenues below).
    if (!MD5_PATTERN.test(md5Expected)) {
        throw new Error('dblp.org did not return a valid MD5 (likely blocked by anti-bot protection)');
    }
    return md5Expected.toLowerCase();
};

// A user can fetch dblp.xml.gz/.gz.md5 by hand through a real browser (the
// only thing that currently gets past dblp.org's anti-bot wall -- see
// getCurrentMD5) and drop both next to each other in the container with
// `docker cp`. This is the same filename dblp.org itself uses, so that
// manual flow needs no extra renaming step.
const getProvidedMD5 = async () => {
    try {
        const content = await readFile('/data/dblp/dblp.xml.gz.md5', 'utf-8');
        const md5 = content.trim().split(/\s+/)[0];
        return MD5_PATTERN.test(md5) ? md5.toLowerCase() : null;
    } catch (error) {
        return null;
    }
};

const storeMD5 = async (md5Value) => {
    await writeFile('/data/dblp/localMD5.txt', md5Value, 'utf-8');
};

const getStoredMD5 = async () => {
    try {
        return (await readFile('/data/dblp/localMD5.txt', 'utf-8')).trim();
    } catch (error) {
        return null;
    }
};

const verifyMD5 = async (md5Expected) => {
    const hash = crypto.createHash('md5');
    const fileStream = createReadStream('/data/dblp/dblp.xml.gz');

    await new Promise((resolve, reject) => {
        fileStream.on('data', (chunk) => {
            hash.update(chunk);
        });
        fileStream.on('end', resolve);
        fileStream.on('error', reject);
    });

    const md5Actual = hash.digest('hex');
    console.log(`Actual MD5: ${md5Actual}`);
    console.log(`Expected MD5: ${md5Expected}`)
    if (md5Actual !== md5Expected) {
        throw new Error('MD5 checksum mismatch');
    }
};



const decompressFile = async () => {
    const totalSize = statSync('/data/dblp/dblp.xml.gz').size;  // obtenir la taille du fichier gz
    let readSize = 0;
    const pp = printProgress('Decompression')
    const reader = createReadStream('/data/dblp/dblp.xml.gz');
    const writer = createWriteStream('/data/dblp/dblp.xml');
    const unzip = gunzip();

    await new Promise((resolve, reject) => {
        pipeline(reader, unzip, writer, (err) => {
            if (err) reject(err);
            else resolve();
        });

        reader.on('data', (chunk) => {
            readSize += chunk.length;
            pp(readSize, totalSize);
        });
    });

    console.log('\nDecompression completed!');
};


const BATCH_SIZE = 10000;


const processXML = async (filePath) => {
    const client = await getClient();
    await client.connect();
    const db = client.db("dblp");

    const parser = sax.createStream(true);
    const fileStream = createReadStream(filePath);
    const totalSize = statSync(filePath).size;
    let readSize = 0;
    let currentNode = null;
    let currentObject = {};
    let lastNodeName = null;
    const validNodes = ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'phdthesis', 'mastersthesis', 'www', 'person', 'data'];
    const pp = printProgress('Copying to DB');

    console.log('Processing started, remove all previous data...');

    for (let nodeType of validNodes) {
        const collection = db.collection(nodeType);
        await collection.deleteMany({});
    }
    console.log('Previous data removed!');

    // Création des files d'attente pour chaque type de nœud
    const queues = validNodes.reduce((acc, nodeName) => {
        acc[nodeName] = [];
        return acc;
    }, {});

    const processingQueues = new Set();

    const insertBatch = async (collectionName, batch) => {
        const collection = db.collection(collectionName);
        await collection.insertMany(batch);
    };

    const processInsertionQueue = async (nodeType) => {
        if (processingQueues.has(nodeType)) {
            return;
        }
        processingQueues.add(nodeType);

        const queue = queues[nodeType];
        while (queue.length > BATCH_SIZE) {
            const batch = queue.splice(0, BATCH_SIZE);
            await insertBatch(nodeType, batch);
        }

        processingQueues.delete(nodeType);
    };

    return new Promise(async (resolve, reject) => {
        parser.on('opentag', (node) => {
            if (validNodes.includes(node.name)) {
                currentNode = node.name;
                currentObject = {
                    _id: uuidv4()
                };
            } else if (currentNode) {
                lastNodeName = node.name;
                currentObject[lastNodeName] = '';
            }
        });

        parser.on('text', (text) => {
            if (lastNodeName && currentObject.hasOwnProperty(lastNodeName)) {
                currentObject[lastNodeName] += text.trim();
            }
        });

        parser.on('closetag', (nodeName) => {
            if (validNodes.includes(nodeName) && currentNode === nodeName) {
                queues[currentNode].push(currentObject);

                if (queues[currentNode].length >= BATCH_SIZE) {
                    processInsertionQueue(currentNode);
                }

                currentNode = null;
                currentObject = {};
            }
        });

        // dblp's dump declares (and actually is) ISO-8859-1, not UTF-8 --
        // feeding it raw Buffer chunks makes sax decode them as UTF-8 by
        // default (Buffer#toString()'s own default), which both mangles
        // every accented character and trips sax's strict-mode check that
        // the declared encoding matches what it's reading, crashing the
        // whole process (sax is an EventEmitter; an 'error' with no
        // listener is a thrown exception, see the listener added below).
        // ISO-8859-1 is one byte per character, so decoding chunk-by-chunk
        // independently -- unlike UTF-8 -- can never split a character
        // across a chunk boundary.
        const decoder = new TextDecoder('iso-8859-1');
        let firstChunk = true;
        fileStream.on('data', (chunk) => {
            readSize += chunk.length;
            pp(readSize, totalSize);
            let text = decoder.decode(chunk, { stream: true });
            if (firstChunk) {
                // Now that the bytes have actually been transcoded to UTF-8
                // (JS strings are UTF-16, and sax's stream write() encodes a
                // string argument as UTF-8), the declaration needs to match.
                text = text.replace(/encoding=["']ISO-8859-1["']/i, 'encoding="UTF-8"');
                firstChunk = false;
            }
            parser.write(text);
        });

        fileStream.on('end', async () => {
            for (let nodeType of validNodes) {
                if (queues[nodeType].length > 0) {
                    await processInsertionQueue(nodeType);
                }
            }
            console.log('\nProcessing completed!');
            resolve();
        });

        fileStream.on('error', (error) => {
            console.error('Error reading the file:', error.message);
            reject(error);
        });

        // Without this, a parse error (malformed XML, an encoding mismatch
        // like the one this function now avoids, ...) is an unhandled
        // 'error' event on the SAXStream -- Node throws it synchronously,
        // crashing the entire API process instead of just failing this one
        // admin-triggered import.
        parser.on('error', (error) => {
            console.error('XML parse error:', error.message);
            reject(error);
        });
    });
};


// Builds url -> official full title from the dump's own "proceedings"
// records (one per conference edition), so inproceedings venues can be
// resolved without ever touching the network -- see venueLookup below.
async function buildProceedingsTitleIndex() {
    const client = await getClient();
    await client.connect();
    const db = client.db('dblp');
    const index = new Map();
    for await (const doc of db.collection('proceedings').find({}, { projection: { url: 1, title: 1 } })) {
        if (doc.url && doc.title) index.set(doc.url, doc.title);
    }
    console.log(`[dblp] Indexed ${index.size} proceedings titles from the local dump.`);
    return index;
}

// resolveLocally(doc): given an inproceedings/article doc from the dump,
// return this venue's full name from data the dump already has, or a
// falsy value to fall back to getVenueFullName's network lookup (i.e. "we
// don't know, ask dblp.org" -- exactly the per-venue scraping that
// throttler.js's dblp_scrape_limiter comment traces back to a prior ~16h
// block, so covering more cases here directly reduces that traffic).
async function venueLookup(collection, filter, resolveLocally) {
    const client = await getClient();
    await client.connect();
    const db = client.db('dblp');
    const venueUrls = new Set();
    const pp = printProgress(`Venues lookup from ${collection}`);

    try {
        console.log("Fetching venue URLs...");
        for await (const doc of db.collection('venues').find({})) {
            venueUrls.add(doc.url);
        }

        const totalDocs = await db.collection(collection).countDocuments();
        console.log(`Total entries to process: ${totalDocs}`);

        const confsCursor = db.collection(collection).find({});
        let processed = 0;
        let count = 0;
        let fromLocal = 0;

        for await (const doc of confsCursor) {
            if (doc.url && doc.url.startsWith(filter)) {
                const url = doc.url.split('#')[0];
                if (!venueUrls.has(url)) {
                    count++;
                    venueUrls.add(url);
                    let venue = resolveLocally ? resolveLocally(doc) : null;
                    if (venue) {
                        fromLocal++;
                    } else {
                        venue = await getVenueFullName(url);
                        if (venue === "") {
                            venue = doc.title;
                        }
                    }

                    try {
                        await db.collection('venues').insertOne({
                            "url": url,
                            "venue": venue
                        });
                    } catch (insertError) {
                        console.error("An error occurred during insertion:", insertError);
                    }
                }
            }
            processed++;
            pp(processed, totalDocs);
        }

        console.log(`\n${count} elements inserted in venues (${fromLocal} resolved locally from the dump, ${count - fromLocal} needed a live dblp.org lookup).`);
    } catch (error) {
        console.error("An error occurred:", error);
    } finally {
        client.close();
    }
}

export const extractVenues = async () => {
    try {
        await mkdir('/data/dblp', { recursive: true });

        // dblp.org's freshness check (getCurrentMD5) currently fails the
        // same way everything else on the site does under its anti-bot
        // protection -- fall back to a manually-provided sidecar .md5 (see
        // getProvidedMD5) so a dump fetched by hand through a real browser
        // and `docker cp`'d in next to it still gets picked up and processed.
        let targetMD5 = await getCurrentMD5().catch((error) => {
            console.log(`[dblp] Could not check dblp.org for a newer dump (${error.message}), falling back to a locally provided one if any.`);
            return null;
        });
        const viaLiveCheck = targetMD5 != null;
        if (!targetMD5) {
            targetMD5 = await getProvidedMD5();
        }
        const storedMD5 = await getStoredMD5();

        if (!targetMD5) {
            console.log('[dblp] No dump available: dblp.org is unreachable and no dblp.xml.gz.md5 sidecar was found next to /data/dblp/dblp.xml.gz.');
        } else if (storedMD5 === targetMD5) {
            console.log('File has not been updated. Nothing to do.');
        } else {
            console.log(`Target MD5: ${targetMD5}`);
            // Only attempt the live download when the freshness check
            // itself came from dblp.org -- if we're here via a provided
            // sidecar file instead, dblp.org can't be reached from here at
            // all (that's the whole point of the sidecar path), so a
            // download attempt would just overwrite the manually-placed
            // .gz with an Anubis challenge page.
            if (viaLiveCheck) {
                console.log('File has been updated. Downloading...');
                await downloadFile();
            }
            await verifyMD5(targetMD5);
            await storeMD5(targetMD5);
            console.log('MD5 verification passed!');
            await decompressFile();
            await processXML('/data/dblp/dblp.xml');
            const proceedingsTitles = await buildProceedingsTitleIndex();
            await venueLookup('inproceedings', 'db/conf/', (doc) => proceedingsTitles.get(doc.url?.split('#')[0]));
            // Journal articles already carry their own journal name
            // directly (doc.journal) -- no cross-collection lookup needed.
            await venueLookup('article', 'db/journals/', (doc) => doc.journal || null);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
};

export async function controllerVenues(req, res) {
    res.send("Launching extraction of venues ...");
    extractVenues();
}




// *******************************************************************************************************
// Admin dashboard: a lightweight in-app alternative to a full
// Prometheus/Grafana/Loki stack (deliberately not adding new always-on
// services on a VM with a documented OOM history). No existing auth system
// in this app, so a single shared-secret token is the pragmatic floor for a
// prototype — not a claim of real access control.
// *******************************************************************************************************

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomUUID();
if (!process.env.ADMIN_TOKEN) {
    console.log(`\x1b[35m[Admin]\x1b[0m No ADMIN_TOKEN set — generated one for this run: ${ADMIN_TOKEN}`);
}

export function requireAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

export async function controllerStats(req, res) {
    try {
        const client = await getClient();
        const db = client.db('dblp');

        const [venuesCount, mongoOk, redisStatus] = await Promise.all([
            db.collection('venues').countDocuments().catch(() => null),
            db.admin().ping().then(() => true).catch(() => false),
            cache.status(),
        ]);

        res.json({
            process: {
                uptimeSeconds: Math.round(process.uptime()),
                memory: process.memoryUsage(),
            },
            metrics: metrics.snapshot(),
            throttler: throttler.status(),
            ranking: {
                queue: ranking.status(),
                activeStreams: activeStreams.list(),
            },
            mongo: { ok: mongoOk, venuesCount },
            redis: redisStatus,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}





// *******************************************************************************************************
// *******************************************************************************************************



const processXMLbis = async (filePath) => {
    const client = await getClient();
    await client.connect();
    const db = client.db("test");

    const parser = sax.createStream(true);
    const fileStream = createReadStream(filePath);
    const totalSize = statSync(filePath).size;
    let readSize = 0;
    let currentNode = null;
    let currentObject = {};
    let lastNodeName = null;
    const validNodes = ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'phdthesis', 'mastersthesis', 'www', 'person', 'data'];
    const pp = printProgress('Copying to DB');

    console.log('Processing started, remove all previous data...');

    for (let nodeType of validNodes) {
        const collection = db.collection(nodeType);
        await collection.deleteMany({});
    }
    console.log('Previous data removed!');

    // Création des files d'attente pour chaque type de nœud
    const queues = validNodes.reduce((acc, nodeName) => {
        acc[nodeName] = [];
        return acc;
    }, {});

    const processingQueues = new Set();

    const insertBatch = async (collectionName, batch) => {
        const collection = db.collection(collectionName);
        await collection.insertMany(batch);
    };

    const processInsertionQueue = async (nodeType) => {
        if (processingQueues.has(nodeType)) {
            return;
        }
        processingQueues.add(nodeType);

        const queue = queues[nodeType];
        while (queue.length > BATCH_SIZE) {
            const batch = queue.splice(0, BATCH_SIZE);
            console.log("batch : ", batch)
            await insertBatch(nodeType, batch);
        }

        processingQueues.delete(nodeType);
    };

    return new Promise(async (resolve, reject) => {
        parser.on('opentag', (node) => {
            if (validNodes.includes(node.name)) {
                console.log("node.name : ", node.name);
                currentNode = node.name;
                currentObject = {
                    _id: uuidv4()
                };
            } else if (currentNode) {
                lastNodeName = node.name;
                currentObject[lastNodeName] = '';
            }
        });

        parser.on('text', (text) => {
            if (lastNodeName && currentObject.hasOwnProperty(lastNodeName)) {
                currentObject[lastNodeName] += text.trim();
            }
        });

        parser.on('closetag', (nodeName) => {
            if (validNodes.includes(nodeName) && currentNode === nodeName) {
                console.log('close tag : ', nodeName);
                console.log(currentObject);
                queues[currentNode].push(currentObject);

                if (queues[currentNode].length >= BATCH_SIZE) {
                    processInsertionQueue(currentNode);
                }

                currentNode = null;
                currentObject = {};
            }
        });

        fileStream.on('data', (chunk) => {
            readSize += chunk.length;
            pp(readSize, totalSize);
            parser.write(chunk);
        });

        fileStream.on('end', async () => {
            for (let nodeType of validNodes) {
                if (queues[nodeType].length > 0) {
                    await processInsertionQueue(nodeType);
                }
            }
            console.log('\nProcessing completed!');
            client.close();
            resolve();
        });

        fileStream.on('error', (error) => {
            console.error('Error reading the file:', error.message);
            reject(error);
        });
    });
};

export async function test() {
    try {
        const path = "./dblp_mini.xml";
        await processXMLbis(path);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

