import fetch from 'node-fetch';
import crypto from 'crypto'; // used for both the DBLP dump MD5 check and the admin token below
import { pipeline } from 'stream';
import gunzip from 'gunzip-maybe';
import { createWriteStream, statSync, createReadStream } from 'fs';
import { writeFile, readFile, mkdir, stat } from 'fs/promises';
import sax from 'sax';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from './db.js';
import { tokenizeName } from './dblpLocal.js';
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

// The dblp DTD's top-level record types (`dblp (article|inproceedings|...)`).
const DBLP_NODE_TYPES = ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'phdthesis', 'mastersthesis', 'www', 'person', 'data'];

// Per the DTD, %titlecontents; = "#PCDATA|sub|sup|i|tt|ref" -- the only
// tags that can nest inside a field (specifically <title>).
const TITLE_MARKUP_TAGS = new Set(['sub', 'sup', 'i', 'tt', 'ref']);

// Wires up the field-extraction rules shared by every way this file turns
// DBLP XML into a document: a full-file streaming pass (processXML) and
// the mdate-filtered incremental one (applyIncrementalUpdate) -- see
// streamDblpRecords, which both go through. `onRecord(nodeType, doc)`
// fires once per complete top-level record (article/inproceedings/.../data
// -- see DBLP_NODE_TYPES); records never nest per the DTD, so there's
// exactly one "current" one at a time regardless of caller.
function wireRecordParser(parser, onRecord) {
    let currentNode = null;
    let currentObject = {};
    let lastNodeName = null;

    parser.on('opentag', (node) => {
        if (DBLP_NODE_TYPES.includes(node.name)) {
            currentNode = node.name;
            currentObject = {
                // The record's identifier per the DTD (key CDATA
                // #REQUIRED on every record type) -- e.g.
                // "homepages/07/1990" for a person, "conf/xxx/Foo20" for a
                // paper. Always present, unlike the <url> child element
                // (optional, and what the rest of this file keys venues
                // by), so it's the reliable way to look a specific record
                // up directly, e.g. an author's own homepage record by
                // PID. Kept as a real field (not just _id, set by callers
                // from this same value) so existing queries against `key`
                // don't need to change.
                key: node.attributes.key,
                // Also CDATA #REQUIRED per the DTD, ISO date ("2026-09-08")
                // -- dblp bumps this on every record it touches, added or
                // modified. applyIncrementalUpdate compares this directly
                // against its stored watermark (plain string comparison is
                // a correct date "after" check for this format) to decide
                // what to skip without ever queueing it.
                mdate: node.attributes.mdate,
            };
        } else if (TITLE_MARKUP_TAGS.has(node.name)) {
            // Transparent: per the DTD these only ever nest inside
            // <title> (sub/sup for e.g. "L_1"-style math, i/tt for
            // formatting, ref for an embedded link) -- leaving
            // lastNodeName untouched means their own text still gets
            // appended to the title that's already accumulating below,
            // instead of being mistaken for a new sibling field (which
            // both truncated the title at the first such tag and left a
            // spurious one-off "sub"/"i"/etc. field on the record).
        } else if (currentNode) {
            lastNodeName = node.name;
            // A field can legitimately repeat within one record (most
            // commonly <author>, but per the DTD any field can) -- the
            // first occurrence is stored as a plain string as before; a
            // second occurrence promotes it to an array so no value is
            // silently overwritten by the next one.
            if (currentObject.hasOwnProperty(lastNodeName)) {
                const existing = currentObject[lastNodeName];
                currentObject[lastNodeName] = Array.isArray(existing) ? [...existing, ''] : [existing, ''];
            } else {
                currentObject[lastNodeName] = '';
            }
        }
    });

    parser.on('text', (text) => {
        if (!lastNodeName || !currentObject.hasOwnProperty(lastNodeName)) return;
        const value = currentObject[lastNodeName];
        if (Array.isArray(value)) {
            value[value.length - 1] += text.trim();
        } else {
            currentObject[lastNodeName] += text.trim();
        }
    });

    parser.on('closetag', (nodeName) => {
        if (DBLP_NODE_TYPES.includes(nodeName) && currentNode === nodeName) {
            currentObject._id = currentObject.key;
            onRecord(currentNode, currentObject);
            currentNode = null;
            currentObject = {};
        }
    });
}

// Streams `filePath` through the shared record parser (wireRecordParser)
// with real backpressure, batching each node type's kept records and
// calling `flush(nodeType, batch)` once a batch reaches BATCH_SIZE (and
// once more for the tail at EOF). Shared by processXML (keeps everything,
// flush = plain insert into an already-emptied collection) and
// applyIncrementalUpdate (keeps only mdate-filtered records, flush =
// upsert) so the file-reading/decoding/backpressure machinery -- the part
// that actually matters for staying within the api container's memory
// budget on a ~5.3GB dump -- exists in exactly one place.
//
// `keep(nodeType, doc)` decides whether a parsed record is queued (and so
// ever reaches `flush`) at all; returning false for most records is what
// makes applyIncrementalUpdate cheap despite still having to read the
// whole file (dblp doesn't publish a smaller delta -- see its own
// comment).
async function streamDblpRecords(filePath, { keep = () => true, flush }) {
    const parser = sax.createStream(true);
    const fileStream = createReadStream(filePath);
    const totalSize = statSync(filePath).size;
    let readSize = 0;
    const pp = printProgress('Copying to DB');

    const queues = DBLP_NODE_TYPES.reduce((acc, n) => { acc[n] = []; return acc; }, {});

    // Backpressure: flush is slower per record than the parser (SAX-driven,
    // synchronous) can produce records. Unthrottled, the queues would grow
    // without bound over the course of the file. This tracks each type's
    // drain as an actual Promise (not a boolean flag) so the file-reading
    // loop below can directly `await` the real in-flight drain -- of every
    // type, whether it started it or one is already running.
    const MAX_QUEUED = BATCH_SIZE * 3;
    const totalQueued = () => DBLP_NODE_TYPES.reduce((sum, n) => sum + queues[n].length, 0);
    const drainPromises = new Map();

    // Drains one type's queue to empty. Idempotent to call concurrently:
    // a second call while one's already running just returns the same
    // promise instead of starting a redundant drain, so callers can
    // always `await drainQueue(type)` and know it resolves only once
    // every record queued *as of that call* (not just some of it) has
    // actually been written.
    const drainQueue = (nodeType) => {
        const inFlight = drainPromises.get(nodeType);
        if (inFlight) return inFlight;
        const queue = queues[nodeType];
        if (queue.length === 0) return Promise.resolve();
        const promise = (async () => {
            while (queue.length > 0) {
                const batch = queue.splice(0, BATCH_SIZE);
                await flush(nodeType, batch);
            }
        })().finally(() => drainPromises.delete(nodeType));
        drainPromises.set(nodeType, promise);
        return promise;
    };

    return new Promise((resolve, reject) => {
        wireRecordParser(parser, (nodeType, doc) => {
            if (!keep(nodeType, doc)) return;
            queues[nodeType].push(doc);
            if (queues[nodeType].length >= BATCH_SIZE) {
                drainQueue(nodeType); // fire-and-forget; see the for-await loop for the actual backpressure cap
            }
        });

        // Registered up front (wireRecordParser adds its own listeners
        // synchronously above; this needs to be in place before the
        // for-await loop below suspends on its first chunk) -- an
        // unhandled 'error' on an EventEmitter throws synchronously and
        // crashes the whole process (sax's own parse errors: malformed
        // XML, an encoding mismatch like the one this function otherwise
        // avoids).
        parser.on('error', (error) => {
            console.error('XML parse error:', error.message);
            reject(error);
        });

        // dblp's dump declares (and actually is) ISO-8859-1, not UTF-8 --
        // feeding it raw Buffer chunks makes sax decode them as UTF-8 by
        // default (Buffer#toString()'s own default), which both mangles
        // every accented character and trips sax's strict-mode check that
        // the declared encoding matches what it's reading. ISO-8859-1 is
        // one byte per character, so decoding chunk-by-chunk independently
        // -- unlike UTF-8 -- can never split a character across a chunk
        // boundary.
        const decoder = new TextDecoder('iso-8859-1');
        let firstChunk = true;

        (async () => {
            try {
                // for-await gives real backpressure: the underlying stream
                // won't read the next chunk until this loop body's promise
                // resolves, so `await`ing the drain here directly pauses
                // reading whenever writes fall behind parsing.
                for await (const chunk of fileStream) {
                    readSize += chunk.length;
                    pp(readSize, totalSize);
                    let text = decoder.decode(chunk, { stream: true });
                    if (firstChunk) {
                        // Now that the bytes have actually been transcoded
                        // to UTF-8 (JS strings are UTF-16, and sax's stream
                        // write() encodes a string argument as UTF-8), the
                        // declaration needs to match.
                        text = text.replace(/encoding=["']ISO-8859-1["']/i, 'encoding="UTF-8"');
                        firstChunk = false;
                    }
                    parser.write(text);
                    if (totalQueued() > MAX_QUEUED) {
                        await Promise.all(DBLP_NODE_TYPES.map((nodeType) => drainQueue(nodeType)));
                    }
                }
                await Promise.all(DBLP_NODE_TYPES.map((nodeType) => drainQueue(nodeType)));
                console.log('\nProcessing completed!');
                resolve();
            } catch (error) {
                console.error('Error reading the file:', error.message);
                reject(error);
            }
        })();
    });
}

// Full rebuild: drops every DBLP collection, then reinserts every record
// from the dump. Returns the highest mdate seen across the whole file, so
// extractVenues can seed applyIncrementalUpdate's watermark from a run
// that (unlike an incremental one) is guaranteed to have looked at every
// record dblp currently publishes.
const processXML = async (filePath) => {
    const client = await getClient();
    await client.connect();
    const db = client.db("dblp");

    console.log('Processing started, removing previous data...');
    for (const nodeType of DBLP_NODE_TYPES) {
        await db.collection(nodeType).deleteMany({});
    }
    console.log('Previous data removed!');

    let maxMdate = null;

    await streamDblpRecords(filePath, {
        keep: (nodeType, doc) => {
            if (doc.mdate && (!maxMdate || doc.mdate > maxMdate)) maxMdate = doc.mdate;
            return true;
        },
        flush: async (nodeType, batch) => {
            // ordered: false -- _id is now the record's own `key` (see
            // wireRecordParser), not a guaranteed-unique uuid, so a rare
            // duplicate key within one dump shouldn't abort the rest of
            // an otherwise-good batch.
            await db.collection(nodeType).insertMany(batch, { ordered: false });
        },
    });

    return maxMdate;
};

const MDATE_WATERMARK_PATH = '/data/dblp/lastMdate.txt';

const getStoredMdateWatermark = async () => {
    try {
        return (await readFile(MDATE_WATERMARK_PATH, 'utf-8')).trim();
    } catch (error) {
        return null;
    }
};

const storeMdateWatermark = async (mdate) => {
    await writeFile(MDATE_WATERMARK_PATH, mdate, 'utf-8');
};

// Applies just the additions/modifications the newest dump carries over the
// last one this app actually imported, instead of a full drop + reinsert.
// See extractVenues for when this runs instead of processXML.
//
// Per dblp's own dump format every top-level record carries its own
// last-modified date as an `mdate="YYYY-MM-DD"` attribute (ISO date, so a
// plain string comparison against `watermark` is a correct "after" check
// -- see wireRecordParser). streamDblpRecords's `keep` skips anything
// whose mdate hasn't advanced past `watermark` before it's ever queued,
// let alone written -- the whole dump still has to be *read* once (dblp
// doesn't publish a smaller delta file), but nothing about the write cost
// scales with how much of the corpus is unchanged.
//
// Deliberately no add-vs-modify distinction, and no deletion handling: a
// record dblp actually removed (merged/retracted) has no entry left in the
// new dump to carry an mdate past the watermark, so it never shows up here
// at all -- rare in practice, left for a future full reimport (processXML)
// to eventually clean up rather than tracked incrementally.
async function applyIncrementalUpdate(filePath, watermark) {
    const client = await getClient();
    await client.connect();
    const db = client.db('dblp');

    let maxMdate = watermark;
    let touchedCount = 0;
    const touchedIdsByType = DBLP_NODE_TYPES.reduce((acc, n) => { acc[n] = []; return acc; }, {});

    await streamDblpRecords(filePath, {
        keep: (nodeType, doc) => {
            if (!doc.mdate || doc.mdate <= watermark) return false;
            if (doc.mdate > maxMdate) maxMdate = doc.mdate;
            touchedIdsByType[nodeType].push(doc._id);
            touchedCount++;
            return true;
        },
        flush: async (nodeType, batch) => {
            const bulkOps = batch.map((doc) => ({
                replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
            }));
            await db.collection(nodeType).bulkWrite(bulkOps, { ordered: false });
        },
    });

    console.log(`[dblp] Incremental update: ${touchedCount} record(s) with mdate > ${watermark}.`);
    return { touchedIdsByType, maxMdate };
}


// Idempotent -- safe (and cheap; createIndex on an already-indexed
// collection is a no-op) to call after every import. `author` backs the
// "which publications mention this exact name" lookup -- without it that
// query would be a full collection scan over millions of documents on
// every author page load. No index needed for the PID -> homepage lookup
// (getLocalAuthorPublications, dblpLocal.js) any more: processXML now sets
// _id to the record's own `key`, so that lookup is a plain (always
// indexed) _id query.
async function ensureIndexes() {
    const client = await getClient();
    const db = client.db('dblp');
    await Promise.all([
        // Backs dblpLocal.js's searchAuthorsByName -- see
        // buildAuthorNameTokens below for what populates this field. A
        // plain index on the raw `author` field doesn't help there: it
        // only holds full "First Last" strings, an anchored prefix regex
        // against it only ever matches a search starting with the very
        // first name, and a case-insensitive regex can't use a plain
        // index at all (would need a collation-aware one, on top of that
        // per-full-string-only limit).
        db.collection('www').createIndex({ authorTokens: 1 }),
        db.collection('inproceedings').createIndex({ author: 1 }),
        db.collection('article').createIndex({ author: 1 }),
    ]);
    console.log('[dblp] Indexes (re)created.');
}

// Populates each person homepage record's authorTokens field (lowercased,
// accent-stripped words from every name variant it lists -- see
// dblpLocal.js's tokenizeName, the single source of truth for this also
// used to tokenize a search query the same way) so searchAuthorsByName can
// match on any individual word ("Gavoille" finding "Cyril Gavoille"), not
// just a prefix of the whole "First Last" string.
//
// `ids`, when given (see applyIncrementalUpdate/extractVenues), scopes
// this to just the homepage records that run's mdate filter actually
// touched -- on a routine dump update that's a small, already-in-memory
// list (a few thousand at most, see applyIncrementalUpdate) out of ~4.2M
// total, so skipping the rest (their tokens can't have changed) is most
// of the win from making the update incremental in the first place. A
// full import (processXML) has no such list -- everything just got
// rewritten -- so it passes no `ids` and this scans every homepage record.
async function buildAuthorNameTokens(ids = null) {
    const client = await getClient();
    const db = client.db('dblp');
    const filter = ids
        ? { key: { $regex: '^homepages/' }, _id: { $in: ids } }
        : { key: { $regex: '^homepages/' } };
    const total = await db.collection('www').countDocuments(filter);
    const pp = printProgress('Building author name-token index');
    const cursor = db.collection('www').find(filter, { projection: { author: 1 } });
    let batch = [];
    let processed = 0;
    for await (const doc of cursor) {
        const names = Array.isArray(doc.author) ? doc.author : (doc.author ? [doc.author] : []);
        const tokens = [...new Set(names.flatMap(tokenizeName))];
        batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { authorTokens: tokens } } } });
        if (batch.length >= 5000) {
            await db.collection('www').bulkWrite(batch, { ordered: false });
            batch = [];
        }
        processed++;
        pp(processed, total);
    }
    if (batch.length) await db.collection('www').bulkWrite(batch, { ordered: false });
    console.log('\n[dblp] Author name-token index built.');
}

// A field that repeats within one record (see processXML) comes back as an
// array; venue lookup only ever wants one representative value out of it.
function firstOf(value) {
    return Array.isArray(value) ? value[0] : value;
}

// Builds url -> official full title from the dump's own "proceedings"
// records (one per conference edition), so inproceedings venues can be
// resolved without ever touching the network -- see venueLookup below.
async function buildProceedingsTitleIndex() {
    const client = await getClient();
    await client.connect();
    const db = client.db('dblp');
    const index = new Map();
    for await (const rawDoc of db.collection('proceedings').find({}, { projection: { url: 1, title: 1 } })) {
        const doc = { url: firstOf(rawDoc.url), title: firstOf(rawDoc.title) };
        if (doc.url && doc.title) index.set(doc.url, doc.title);
    }
    console.log(`[dblp] Indexed ${index.size} proceedings titles from the local dump.`);
    return index;
}

// resolveLocally(doc): given an inproceedings/article doc from the dump,
// return this venue's full name from data the dump already has. Degraded
// full-local mode -- dblp.org is behind Anubis anti-bot protection (see
// throttler.js's dblp_scrape_limiter comment, tracing back to a prior ~16h
// block from exactly this kind of per-venue scraping), so venueLookup no
// longer falls back to a live lookup at all: whatever resolveLocally can't
// resolve just falls back to doc.title (the entry's own title -- a paper
// title for inproceedings, already the right field for article/journal),
// lower quality than a real venue name but zero network calls.
//
// `ids`, when given (see applyIncrementalUpdate/extractVenues), scopes the
// scan to just the records that run's mdate filter touched in this
// collection -- see the identical note on buildAuthorNameTokens about why
// this is small and already in memory rather than something that needs a
// Mongo-side marker field. A venue already in the `venues` collection was
// necessarily reachable from some earlier (unchanged, so still-present)
// record, so unchanged records can never contribute a *new* venue and
// skipping them is safe.
async function venueLookup(collection, urlPrefix, resolveLocally, ids = null) {
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

        const scanFilter = ids ? { _id: { $in: ids } } : {};
        const totalDocs = await db.collection(collection).countDocuments(scanFilter);
        console.log(`Total entries to process: ${totalDocs}`);

        const confsCursor = db.collection(collection).find(scanFilter);
        let processed = 0;
        let count = 0;
        let fromLocal = 0;

        for await (const rawDoc of confsCursor) {
            const doc = { ...rawDoc, url: firstOf(rawDoc.url) };
            if (doc.url && doc.url.startsWith(urlPrefix)) {
                const url = doc.url.split('#')[0];
                if (!venueUrls.has(url)) {
                    count++;
                    venueUrls.add(url);
                    const venue = firstOf((resolveLocally && resolveLocally(doc)) || doc.title);
                    if (venue) fromLocal++;

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

        console.log(`\n${count} elements inserted in venues (${fromLocal} resolved from the dump, ${count - fromLocal} had no title data at all).`);
    } catch (error) {
        // Rethrown (not just logged): extractVenues only stores the dump's
        // MD5 once every venueLookup call actually finishes, so swallowing
        // this here made a failed/partial run (e.g. the MongoNotConnectedError
        // this code used to cause -- see the client.close() note below) look
        // like a success and get marked "done" with the article venues never
        // actually populated.
        console.error("An error occurred:", error);
        throw error;
    }
    // No client.close() here: getClient() (db.js) hands out one shared,
    // long-lived MongoClient for the whole process -- closing it here left
    // every other Mongo-backed request in the app (author lookups, admin
    // stats, match overrides, ...) throwing MongoNotConnectedError the
    // moment this function finished, until the process was restarted.
}

// Exposed to the front end (see controllerDblpStatus/routes.js) so the DBLP
// tab can disable itself with a clear message instead of silently serving
// wrong results while an import is running -- processXML's drop() (see
// above) empties inproceedings/article/www at the *start* of a rebuild, so
// a search or PID lookup mid-import would otherwise see partial or no data
// at all, not just stale data.
let dblpImportRunning = false;

export async function getDblpStatus() {
    let version = null;
    let importedAt = null;
    try {
        version = (await readFile('/data/dblp/localMD5.txt', 'utf-8')).trim();
        // storeMD5 (see extractVenues) only (re)writes this file once a
        // full import has actually succeeded, so its own mtime is exactly
        // "when was the currently-served dump last (re)imported" -- no
        // separate bookkeeping needed for that.
        importedAt = (await stat('/data/dblp/localMD5.txt')).mtime.toISOString();
    } catch {
        // No successful import yet -- version/importedAt stay null.
    }
    return {
        ready: !dblpImportRunning && version != null,
        importing: dblpImportRunning,
        version,
        importedAt,
    };
}

export const extractVenues = async () => {
    dblpImportRunning = true;
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
            console.log('MD5 verification passed!');
            await decompressFile();

            // No watermark yet means either the very first import, or an
            // MD5 mismatch left over from before this app tracked mdate at
            // all -- either way there's nothing to diff against, so fall
            // back to the full drop + reinsert (processXML) and seed the
            // watermark from what it actually saw. Once a watermark exists,
            // every later dump update only has to look at what changed
            // since it (applyIncrementalUpdate).
            const watermark = await getStoredMdateWatermark();
            let touchedIdsByType = null;
            let maxMdate;
            if (!watermark) {
                console.log('[dblp] No mdate watermark stored yet -- doing a full import.');
                maxMdate = await processXML('/data/dblp/dblp.xml');
            } else {
                console.log(`[dblp] Applying incremental update (mdate > ${watermark}).`);
                ({ touchedIdsByType, maxMdate } = await applyIncrementalUpdate('/data/dblp/dblp.xml', watermark));
            }

            await buildAuthorNameTokens(touchedIdsByType?.www ?? null);
            await ensureIndexes();
            const proceedingsTitles = await buildProceedingsTitleIndex();
            // The dedicated <proceedings> record (when the dump has one) is
            // the official full venue name and is tried first; doc.booktitle
            // -- present on virtually every <inproceedings> entry (99.99% in
            // practice) -- is often just a short/informal form ("PerCom
            // 2007") but is right there on the entry itself, so it's a much
            // better degraded-local fallback than the paper title.
            await venueLookup('inproceedings', 'db/conf/', (doc) => proceedingsTitles.get(doc.url?.split('#')[0]) || doc.booktitle, touchedIdsByType?.inproceedings ?? null);
            // Journal articles already carry their own journal name
            // directly (doc.journal) -- no cross-collection lookup needed.
            await venueLookup('article', 'db/journals/', (doc) => doc.journal || null, touchedIdsByType?.article ?? null);
            // Stored only once the whole pipeline has actually completed --
            // storing it right after verifyMD5 (as this used to) marks the
            // dump "done" even if the process crashes or is interrupted
            // partway through venueLookup, so a later run would see
            // storedMD5 === targetMD5 and skip re-processing entirely,
            // silently leaving the venue index incomplete forever.
            await storeMD5(targetMD5);
            if (maxMdate) await storeMdateWatermark(maxMdate);
        }
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        dblpImportRunning = false;
    }
};

export async function controllerVenues(req, res) {
    res.send("Launching extraction of venues ...");
    extractVenues();
}

export async function controllerDblpStatus(req, res) {
    res.json(await getDblpStatus());
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
    // X-Admin-Token/?token= are what the front end (AdminDashboard.js) and
    // deploy-dblp-dump.sh send. `Authorization: Bearer ...` is added on
    // top for Prometheus's scrape config (monitoring/prometheus.yml's
    // bearer_token_file) -- Prometheus's HTTP client always sends the
    // token that way, with no option to use a custom header name instead.
    const bearerMatch = req.headers['authorization']?.match(/^Bearer (.+)$/);
    const token = req.headers['x-admin-token'] || req.query.token || bearerMatch?.[1];
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
            dblp: await getDblpStatus(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Prometheus text exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/)
// of the same data controllerStats already computes for the in-app admin
// dashboard -- deliberately not a new metrics-collection mechanism, just a
// second serialization of it, so Grafana (see monitoring/) can graph
// history/alert on it instead of only ever showing the current snapshot.
function escapeLabelValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatPrometheusLine(name, value, labels = {}) {
    const labelPairs = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',');
    const labelPart = labelPairs ? `{${labelPairs}}` : '';
    return `${name}${labelPart} ${value}`;
}

export async function controllerPrometheusMetrics(req, res) {
    try {
        const client = await getClient();
        const db = client.db('dblp');
        const [mongoOk, redisStatus, dblpStatus] = await Promise.all([
            db.admin().ping().then(() => true).catch(() => false),
            cache.status(),
            getDblpStatus(),
        ]);
        const snapshot = metrics.snapshot();
        const rankingQueue = ranking.status();

        const lines = [];
        lines.push('# HELP rankme_requests_total Total HTTP requests handled since process start');
        lines.push('# TYPE rankme_requests_total counter');
        lines.push(formatPrometheusLine('rankme_requests_total', snapshot.totalRequests));

        lines.push('# HELP rankme_errors_total Total HTTP requests with status >= 400');
        lines.push('# TYPE rankme_errors_total counter');
        lines.push(formatPrometheusLine('rankme_errors_total', snapshot.totalErrors));

        lines.push('# HELP rankme_route_requests_total Requests per route since process start');
        lines.push('# TYPE rankme_route_requests_total counter');
        for (const r of snapshot.routes) {
            const [method, route] = r.route.split(' ');
            lines.push(formatPrometheusLine('rankme_route_requests_total', r.count, { method, route }));
        }

        lines.push('# HELP rankme_route_latency_ms Route latency percentiles, ms, over the last 500 requests per route');
        lines.push('# TYPE rankme_route_latency_ms gauge');
        for (const r of snapshot.routes) {
            const [method, route] = r.route.split(' ');
            lines.push(formatPrometheusLine('rankme_route_latency_ms', r.p50, { method, route, quantile: '0.5' }));
            lines.push(formatPrometheusLine('rankme_route_latency_ms', r.p95, { method, route, quantile: '0.95' }));
            lines.push(formatPrometheusLine('rankme_route_latency_ms', r.p99, { method, route, quantile: '0.99' }));
        }

        lines.push('# HELP rankme_ranking_queue_depth Ranking job queue, by Bottleneck state');
        lines.push('# TYPE rankme_ranking_queue_depth gauge');
        for (const [state, value] of Object.entries(rankingQueue)) {
            lines.push(formatPrometheusLine('rankme_ranking_queue_depth', value, { state }));
        }

        lines.push('# HELP rankme_mongo_up Mongo connectivity (1 = reachable, 0 = not)');
        lines.push('# TYPE rankme_mongo_up gauge');
        lines.push(formatPrometheusLine('rankme_mongo_up', mongoOk ? 1 : 0));

        lines.push('# HELP rankme_redis_up Redis connectivity (1 = reachable, 0 = not)');
        lines.push('# TYPE rankme_redis_up gauge');
        lines.push(formatPrometheusLine('rankme_redis_up', redisStatus.ok ? 1 : 0));

        lines.push('# HELP rankme_dblp_ready Whether the local DBLP dump is ready to serve (1 = yes)');
        lines.push('# TYPE rankme_dblp_ready gauge');
        lines.push(formatPrometheusLine('rankme_dblp_ready', dblpStatus.ready ? 1 : 0));

        lines.push('# HELP rankme_dblp_importing Whether a DBLP dump (re)import is currently running (1 = yes)');
        lines.push('# TYPE rankme_dblp_importing gauge');
        lines.push(formatPrometheusLine('rankme_dblp_importing', dblpStatus.importing ? 1 : 0));

        lines.push('# HELP rankme_process_rss_bytes Node process resident set size');
        lines.push('# TYPE rankme_process_rss_bytes gauge');
        lines.push(formatPrometheusLine('rankme_process_rss_bytes', process.memoryUsage().rss));

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(lines.join('\n') + '\n');
    } catch (error) {
        res.status(500).send(`# error generating metrics: ${escapeLabelValue(error.message)}\n`);
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
            // Not closed here -- see the identical note in venueLookup:
            // getClient() hands out one shared client for the whole process.
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

