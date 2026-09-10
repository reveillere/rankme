import Papa from 'papaparse';
import fetch from './throttler.js';
import { normalizeTitle, levenshtein } from './levenshtein.js';
import * as cache from './cache.js'
import { dedupeInFlight } from './inFlight.js';
import { getVenueFullName }  from './dblp.js';
import { getClient } from './db.js';
import { readFile } from 'fs/promises';

let config = null;

const BASE = 'https://www.scimagojr.com/journalrank.php?out=xls&year=';
const CSV_DIR = '/data/scimagojr';

// A computed (journal, year) rank essentially never changes afterwards --
// see the identical constant/reasoning in corePortal.js.
const RANK_CACHE_TTL_S = 60 * 60 * 24 * 365;

// A query word lands directly in a MongoDB $regex below -- escaped so a
// character like "+" or "(" (common in journal titles, e.g. "C++") is
// matched literally instead of being read as a regex operator.
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// computeRank pulled an entire year's scimagojr collection into memory
// (Mongo find({}).toArray()) AND re-normalized every title in it, on every
// single call -- and this can happen up to 8x concurrently (ranking.js's
// ranking_limiter). A year's documents are immutable for the process
// lifetime (load() above only ever inserts once per year, guarded by the
// `count === 0` check), so both the fetch and the normalization are worth
// caching.
//
// Measured cost of holding a year resident, in exactly this trimmed shape
// (Sourceid/Title/BestQuartile + a pre-normalized title -- Categories/Areas
// are parsed by parseCSV but never read by computeRank/attachCurrentValue,
// so they're dropped here): loading all 27 years (1999-2025) grew heap
// usage from ~12MB to ~365MB, i.e. roughly 13-18MB per year (newer years,
// with more indexed journals, cost more). Holding all 27 resident at once
// would be over a third of this container's 1GB cap (docker-compose.prod.yml)
// on top of the rest of the process (DBLP/CORE data, HTTP/Mongo/Redis
// connections, etc.) -- not a comfortable fit. Capped LRU instead, sized to
// the same 8 as ranking_limiter's maxConcurrent so that 8 concurrent
// requests for 8 different years can each keep their own year resident
// without evicting each other's in the worst case: worst-case retained size
// is then ~8 * 18MB =~ 150MB, comfortably inside budget. In practice the
// hit rate is much better than "1 year per request" -- attachCurrentValue
// below always wants config.end (see next comment), which keeps that one
// year almost permanently hot regardless of what else cycles through.
const YEAR_CACHE_MAX_SIZE = 8;
const yearCache = new Map(); // insertion order == LRU order (oldest first)

async function getYearData(year) {
    const key = year.toString();
    if (yearCache.has(key)) {
        // Re-insert to move this key to the end (most-recently-used) --
        // content is unchanged, only its position in eviction order.
        const data = yearCache.get(key);
        yearCache.delete(key);
        yearCache.set(key, data);
        return data;
    }
    const client = await getClient();
    const db = client.db("scimagojr");
    const documents = (await db.collection(key).find({}).toArray()).filter(item => item.Title !== null);
    const docs = documents.map(item => ({
        Sourceid: item.Sourceid,
        Title: item.Title,
        BestQuartile: item.BestQuartile,
        normalizedTitle: normalizeTitle(item.Title),
    }));
    const data = { docs, bySourceid: new Map(docs.map(d => [d.Sourceid, d])) };
    yearCache.set(key, data);
    if (yearCache.size > YEAR_CACHE_MAX_SIZE) {
        yearCache.delete(yearCache.keys().next().value); // evict the oldest (least-recently-used)
    }
    return data;
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

// Load year data from a locally provided CSV file (see CSV_DIR), falling
// back to fetching it from scimagojr.com if no local file is found.
async function loadYearCSV(year) {
    const localPath = `${CSV_DIR}/${year}.csv`;
    try {
        const csvData = await readFile(localPath, 'utf-8');
        console.log(`[sjr] Loading local CSV file: ${localPath}`);
        return await parseCSV(csvData);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    console.log(`Fetching: ${BASE}${year}`);
    const resp = await fetch(`${BASE}${year}`);
    const csvData = await resp.text();
    return await parseCSV(csvData);
}

// Initialize the database
export async function load() {
    console.log('Loading scimagojr database ...');
    try {
        const client = await getClient();
        const db = client.db("scimagojr");

        // Load the configuration parameters
        const collection = db.collection("config");
        const newConfig = { start: 1999, end: 2025 };
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
                try {
                    const jsonObj = await loadYearCSV(year);
                    await collection.insertMany(jsonObj);
                    console.log(`${jsonObj.length} elements inserted into sjr:${collectionName}.`);
                } catch (error) {
                    console.error(`[sjr] Error loading year ${year}:`, error.message);
                }
            }
            // Idempotent (a no-op if it already exists), so safe to call on
            // every startup rather than only right after a fresh insert --
            // speeds up controllerCandidates' Sourceid $in lookup below.
            await collection.createIndex({ Sourceid: 1 });
        }
    } catch (error) {
        console.error('Error during connection or insertion:', error);
    }

    // config only ever fails to get set if the try block above blew up
    // before reaching `config = await collection.findOne(...)` -- in
    // practice, Mongo itself being unreachable. Every SJR lookup needs
    // config.start/config.end, so refuse to start rather than come up and
    // throw on the first real request -- see the identical check/reasoning
    // in corePortal.js's load().
    if (config == null) {
        throw new Error('[sjr] Could not initialize scimagojr config (Mongo unreachable?)');
    }
}

// Structured result shape mirroring corePortal.js's, so the front end can
// build one shared tooltip/edit UI for both CORE and SJR ranks.
function unrankedResult(sourceYear) {
    return { value: 'QU', rawValue: null, source: `scimagojr:${sourceYear}`, matchType: 'none', matchedTitle: null, matchedId: null, distance: null };
}

function ambiguousResult(sourceYear, tied) {
    return {
        value: 'QU', rawValue: null, source: `scimagojr:${sourceYear}`, matchType: 'ambiguous',
        matchedTitle: null, matchedId: null, distance: null,
        ambiguousWith: tied.map(t => ({ title: t.data.Title, id: t.data.Sourceid, value: t.data.BestQuartile })),
    };
}

function sanitizedRank(sourceYear, entry, matchType, distance) {
    return {
        value: entry.BestQuartile, rawValue: null, source: `scimagojr:${sourceYear}`, matchType,
        matchedTitle: entry.Title, matchedId: entry.Sourceid, distance,
    };
}

// Best-effort: same idea as corePortal's attachCurrentValue -- looks up the
// same journal (by its stable Scopus Sourceid) in the most recent scimagojr
// year, so the tooltip can show how it's ranked now versus back when the
// publication actually came out.
async function attachCurrentValue(rank, queryText) {
    rank = { ...rank, queryText };
    if (rank.matchedId == null || config.end == null) return rank;
    const latestSource = `scimagojr:${config.end}`;
    // Already looking at the latest edition -- its quartile IS the current
    // one, no extra lookup needed. Set unconditionally so the front end can
    // always show "current rank", not only when it happens to differ.
    if (rank.source === latestSource) {
        return { ...rank, currentSource: rank.source, currentValue: rank.value };
    }
    try {
        // config.end is exactly the year kept hottest in getYearData's LRU
        // (see its comment) -- almost every call here wants it, so this is
        // a Mongo round-trip trade for a Map lookup nearly all the time,
        // not just when it happens to already be cached.
        const { bySourceid } = await getYearData(config.end);
        const latest = bySourceid.get(rank.matchedId);
        if (!latest) return rank;
        return { ...rank, currentSource: latestSource, currentValue: latest.BestQuartile === '-' ? 'QU' : latest.BestQuartile };
    } catch (error) {
        console.error('[sjr] Error attaching current value', error);
        return rank;
    }
}

// Free-text search over one year's scimagojr entries, for the "change
// match" picker.
export async function controllerCandidates(req, res) {
    const year = Number(req.query.year);
    const q = (req.query.q || '').trim().toLowerCase();
    if (!year) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing year' });
        return;
    }
    try {
        const clampedYear = Math.min(Math.max(year, config.start), config.end);
        if (q.length < 2) {
            res.json({ source: `scimagojr:${clampedYear}`, results: [] });
            return;
        }
        const client = await getClient();
        const db = client.db("scimagojr");
        // Every word in the query must appear in the title (AND across
        // words, not one contiguous substring) -- same idea as
        // corePortal.js's controllerCandidates, so "computer science
        // review" finds a title where those words aren't adjacent.
        const words = q.split(/\s+/).filter(Boolean);
        const documents = await db.collection(clampedYear.toString())
            .find({ $and: words.map(w => ({ Title: { $regex: escapeRegex(w), $options: 'i' } })) })
            .limit(50)
            .toArray();
        // Each result also carries the same journal's quartile in the latest
        // edition -- one batched query (not one per result) -- so a user
        // picking a match to override with sees the same "current rank" info
        // the automatic match already gets.
        const latestYear = config.end;
        const currentById = new Map();
        if (latestYear && latestYear !== clampedYear && documents.length > 0) {
            const latestDocs = await db.collection(latestYear.toString())
                .find({ Sourceid: { $in: documents.map(d => d.Sourceid) } })
                .toArray();
            latestDocs.forEach(d => currentById.set(d.Sourceid, d.BestQuartile === '-' ? 'QU' : d.BestQuartile));
        }
        const results = documents.map(d => ({
            id: d.Sourceid, title: d.Title, value: d.BestQuartile === '-' ? 'QU' : d.BestQuartile,
            currentSource: latestYear ? `scimagojr:${latestYear}` : null,
            currentValue: latestYear === clampedYear ? (d.BestQuartile === '-' ? 'QU' : d.BestQuartile) : (currentById.get(d.Sourceid) ?? null),
        }));
        res.json({ source: `scimagojr:${clampedYear}`, results });
    } catch (error) {
        console.error('[sjr] Error searching candidates', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

async function computeRank(venueFullName, year) {
    try {
        if (year < config.start) {
            year = config.start;
        }
        if (year > config.end) {
            year = config.end;
        }
        const { docs } = await getYearData(year);
        const titleNormalized = normalizeTitle(venueFullName);
        // No acronym concept for journals, so this is always matching on
        // title words alone against the whole scimagojr list -- same false
        // positive risk as CORE's fuzzy-only path, so kept just as tight.
        const MAX_FUZZY_DISTANCE = 2;
        // Same rationale as CORE's fuzzy-only path: word-level edit distance
        // is trivially small between any two short, unrelated title word
        // lists, so a single normalized word can't be fuzzy-matched safely
        // at all, and longer queries still need the allowed distance scaled
        // to their own length rather than a flat cap.
        if (titleNormalized.length < 2) {
            return { ...unrankedResult(year), queryText: venueFullName };
        }
        const maxAllowedDistance = Math.min(MAX_FUZZY_DISTANCE, Math.floor(titleNormalized.length / 2));
        const result = docs.map(item => {
            const distance = levenshtein(item.normalizedTitle, titleNormalized);
            return { data: item, distance: distance };
        }).filter(item => item.distance <= maxAllowedDistance).sort((a, b) => a.distance - b.distance);

        let response;
        if (result.length > 0) {
            const minDistance = result[0].distance;
            const tied = result.filter(r => r.distance === minDistance);
            // scimagojr is full of near-identical titles that are genuinely
            // different journals with different quartiles (e.g. "Nature" vs
            // "Nature Conservation" vs "Nature and Culture" are all one word
            // apart) -- if the equally-close candidates don't even agree on
            // the quartile, picking the one that happened to sort first
            // would be a coin flip.
            const distinctQuartiles = new Set(tied.map(t => t.data['BestQuartile']));
            if (tied.length > 1 && distinctQuartiles.size > 1) {
                response = ambiguousResult(year, tied.map(t => t.data));
            } else {
                const elt = tied[0];
                const rank = elt.data['BestQuartile'];
                response = rank === '-' ? unrankedResult(year) : sanitizedRank(year, elt.data, elt.distance === 0 ? 'exact' : 'fuzzy', elt.distance);
            }
        } else {
            response = unrankedResult(year);
        }
        return attachCurrentValue(response, venueFullName);
    } catch (error) {
        console.error('Error during levenshtein computation', error);
        return { ...unrankedResult(year), queryText: venueFullName };
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

export async function getRank(ref, year) {
    const key = `rank:${year}:${ref}`;

    let rank = await cache.get(key);
    if (rank === null) {
      const venueFullName = await getVenueFullName(ref);
      rank = await computeRank(venueFullName, year);
      // TTL'd (not permanent): a transient miss — e.g. this year's
      // scimagojr collection still being populated by load() at startup —
      // would otherwise get cached as "no ranking found" forever.
      cache.set(key, rank, RANK_CACHE_TTL_S);
    }
    return rank;
}



// ************************************************************************************
// ************************************************************************************
// Rank by full journal name directly (no dblp ref available, e.g. HAL publications)



export async function controllerRank2(req, res) {
    const { fullName, year } = req.body;
    if (!year || !fullName) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing query parameters' });
        return;
    }

    try {
        const rank = await getRankByFullName(fullName, year);
        res.json(rank);
    } catch (error) {
        console.error('Error during rank computation', error);
        res.status(400).json({ error: 'Internal Server Error', message: error.message });
    }
}

// Concurrent calls for the same (year, fullName) -- e.g. two publications
// citing the same journal, ranked within the same ranking_limiter batch or
// across two different browser sessions -- are deduped via inFlightByFullName
// (see dedupeInFlight) rather than each running computeRank's full year-data
// scan independently.
const inFlightByFullName = new Map();

export async function getRankByFullName(fullName, year) {
    const key = `rank:${year}:sjr:${fullName}`;

    const rank = await cache.get(key);
    if (rank !== null) return rank;

    return dedupeInFlight(inFlightByFullName, key, async () => {
        const result = await computeRank(fullName, year);
        // Awaited (unlike cache.set's usual fire-and-forget elsewhere): the
        // in-flight map entry above is removed the instant this wrapper's
        // promise settles (see dedupeInFlight), so a caller arriving between
        // "computed" and "actually written to Redis" would otherwise sail
        // past both the map (already cleared) and cache.get (not yet
        // written) and recompute anyway -- observed happening under real
        // concurrent load (corePortal.js's equivalent) while verifying this
        // fix.
        await cache.set(key, result, RANK_CACHE_TTL_S);
        return result;
    });
}

export default { load }