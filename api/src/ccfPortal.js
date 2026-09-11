import { PDFParse } from 'pdf-parse';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { normalizeTitle, levenshtein, isWorkshopMismatch } from './levenshtein.js';
import * as cache from './cache.js';
import { dedupeInFlight } from './inFlight.js';

import fetch from './throttler.js';

// Official CCF (China Computer Federation) recommended list of
// international conferences and journals -- every URL below verified
// directly (curl) to be a plain, unauthenticated PDF download from CCF's
// own site (ccf.org.cn), not a third-party mirror.
//
// CCF revises this list roughly every 3 years, and each past revision
// keeps ranking whatever was published while it was current -- a paper
// from 2016 should be judged by the edition that was actually in force
// then (the 4th, 2015), not retroactively by the 7th (2026). This mirrors
// corePortal.js's own resolveSource: pick the newest edition whose year is
// <= the publication's year, falling back to the oldest edition available
// for anything older than that.
//
// The 7th (current) edition is the only one CCF can still revise further,
// so load() re-checks it against ccf.org.cn on a monthly throttle (see
// REFRESH_INTERVAL_MS) the way it always has. Editions 1-3 (2010/2011/2013)
// aren't included here: their official download links no longer resolve on
// ccf.org.cn's current site (lost in an old CMS migration), and the only
// copies found elsewhere are third-party mirrors -- out of scope per the
// same "official source only" rule that shaped the 7th edition's own
// sourcing.
export const PDF_URL = 'https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=112CF3BF7E1140ACEB271ADAED12A67ADFABB8FF099E40C2759502A85C8A281F';
const CURRENT_EDITION_YEAR = 2026;

const HISTORICAL_EDITIONS = [
    { year: 2015, url: 'https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=32826' },
    { year: 2019, url: 'https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=99185' },
    { year: 2022, url: 'https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=5CB6670D4D81C9199A7BFFFF19B4DF9241AA041973F36FB2B3CD410B5EC529F8' },
];

const DATA_DIR = '/data/ccf';
// Only the current edition's own snapshot needs a "when was this last
// checked" marker -- a historical edition's own official PDF is finished
// and never changes again once CCF supersedes it with the next one, so
// historical-edition-<year>.json alone (present or not) is the only state
// that file needs.
const ENTRIES_FILE = `${DATA_DIR}/entries-${CURRENT_EDITION_YEAR}.json`;
const FETCHED_AT_FILE = `${DATA_DIR}/fetched-at.txt`;
const historicalEntriesFile = (year) => `${DATA_DIR}/entries-${year}.json`;

// Unlike CORE's own source, which load() re-checks on every process start,
// a monthly check is already generous for a document that essentially
// never changes month to month, and avoids hammering ccf.org.cn (and the
// app's own restart cadence in dev, via nodemon).
const REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

// Cache key includes the *edition's* year, not necessarily the
// publication's own -- two publications from different years can resolve
// to the same edition (see resolveEdition) and should share one cache
// entry instead of recomputing the identical lookup twice.
export function rankKey(editionYear, query) {
    return `rank:ccf:${editionYear}:${query}`;
}

// { year, entries, byDblpKey }[], sorted newest-first once load() has run
// -- editions[0] is always the current/latest edition.
let editions = [];

function resolveEdition(pubYear) {
    if (editions.length === 0) return null;
    const found = editions.find(e => e.year <= pubYear);
    return found || editions[editions.length - 1]; // oldest available, for anything older than every edition
}

// Pulls the "db/(conf|journals)/<venue>" segment out of a dblp url,
// however it's dressed up (http/https, dblp.uni-trier.de/dblp.org, a
// trailing filename or #fragment, with or without a leading path). This is
// the actual match key: CORE/SJR fuzzy-match free-text venue names, but
// CCF's own list already carries a direct dblp reference per entry, and
// every dblp-sourced publication already carries its own dblp url too --
// comparing these two directly is far more reliable than fuzzy title
// matching once both sides agree on the same normalized key.
export function dblpKeyFromUrl(url) {
    if (!url) return null;
    // "db/" can be the very start of the string (rankme's own pub.dblp.url,
    // e.g. "db/journals/tocs/tocs64.html#...") or preceded by a domain
    // (CCF's own entries, e.g. "http://dblp.uni-trier.de/db/journals/tocs/")
    // -- (?:^|\/) covers both without requiring a leading slash.
    const match = /(?:^|\/)db\/(conf|journals)\/([^/]+)/.exec(url);
    return match ? `${match[1]}/${match[2]}` : null;
}

// Parses the plain text pdf-parse extracts from an official CCF PDF into
// { rank, text, url } entries. Exported (rather than kept private) so it
// can be unit-tested directly against a real extracted-text fixture
// without needing network access or a PDF library in the test run. Written
// and tested against the (messier) 7th edition's own text layout, but
// verified (by hand, via a throwaway script) to parse the 4th/5th/6th
// editions' own pdf-parse output just as cleanly with zero changes -- their
// rows mostly land on a single text line each, which this state machine
// already tolerates wrapping across regardless.
//
// The PDF's own layout: repeating sections, each one a domain heading
// (ignored -- CCF's own category taxonomy isn't needed for matching) then
// a "一/二/三、A/B/C 类" rank heading, then a "序号 ... 网址" column
// header, then numbered rows (number, acronym, full name, publisher, dblp
// url) -- a row's own full name can wrap across pdf-parse's extracted text
// lines, and pdf-parse's tab-separated-token layout doesn't preserve
// enough structure to reliably split acronym/name/publisher back apart
// (e.g. a multi-word acronym like "ACM SIGOPS ATC (原 USENIX ATC)" is
// indistinguishable, token-wise, from the start of the full name that
// follows it). That split isn't actually needed for matching, though: the
// combined text blob is exactly what corePortal.js's own fuzzy matching
// already does (acronym + title concatenated) for its HAL fallback path
// (see getRankForHalVenue below) -- so this keeps one `text` field instead
// of guessing a brittle split.
export function parseCcfText(text) {
    const lines = text.split('\n');
    const parsed = [];
    let currentRank = null;
    let inDataZone = false;
    let buf = [];

    const looksLikeUrlStart = (t) => /^https?:\/\//.test(t);
    // A genuine CCF dblp url always contains "/db/" -- a token that merely
    // starts with "http" can still be a PDF page-break artifact (a url
    // hyphen-wrapped mid-word, e.g. "http://dblp.uni-" then "trier.de/db/..."
    // as the next line's first token) that hasn't reached the real url yet.
    // Deliberately not stricter than this (e.g. requiring a clean trailing
    // "/" or known extension): the only thing this data is actually used
    // for is dblpKeyFromUrl's "/db/(conf|journals)/<venue>/" extraction, and
    // a truncated filename suffix (seen once in the wild: "index.ht" missing
    // "ml") doesn't change that prefix -- chasing that case cost more
    // legitimate entries than it fixed when tried.
    const isCompleteUrl = (t) => looksLikeUrlStart(t) && t.includes('/db/');

    const flush = () => {
        if (buf.length === 0) return;
        const urlIdx = buf.findIndex(isCompleteUrl);
        if (urlIdx === -1) { buf = []; return; } // never found a url -- drop, nothing usable
        const url = buf[urlIdx];
        const entryText = buf.slice(1, urlIdx).join(' ').replace(/\s+/g, ' ').trim(); // [0] is the row's own sequence number
        parsed.push({ rank: currentRank, text: entryText, url });
        buf = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '') continue;
        const sectionMatch = line.match(/^[一二三四五六七八九十]、([ABC])\s*类/);
        if (sectionMatch) { flush(); currentRank = sectionMatch[1]; inDataZone = false; continue; }
        if (/^序号/.test(line)) { flush(); inDataZone = true; continue; } // column header -- data rows start right after
        if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue; // pdf-parse's own page marker
        if (/^中国计算机学会/.test(line)) { flush(); inDataZone = false; continue; } // "recommended journals"/"recommended conferences" section title
        if (!inDataZone) continue; // domain heading / any other front matter

        const tokens = line.split(/\t+/).flatMap((t) => t.split(/\s+/)).filter(Boolean);
        if (/^\d+$/.test(tokens[0]) && buf.length === 0) {
            buf = tokens;
        } else if (buf.length && looksLikeUrlStart(buf[buf.length - 1]) && !isCompleteUrl(buf[buf.length - 1])) {
            // Glue this line's first token directly onto the dangling
            // url-start with no space -- see isCompleteUrl's comment.
            buf[buf.length - 1] += tokens[0];
            buf.push(...tokens.slice(1));
        } else {
            buf.push(...tokens);
        }
        if (buf.some(isCompleteUrl)) flush();
    }
    flush();
    return parsed;
}

function buildIndex(list) {
    const map = new Map();
    for (const entry of list) {
        const key = dblpKeyFromUrl(entry.url);
        if (!key) continue;
        // First entry for a given dblp key wins. The official list isn't
        // perfectly self-consistent -- e.g. AsiaCCS's own row points at the
        // same "conf/ccs/" dblp key as CCS itself, rather than
        // "conf/asiaccs/" -- and CCS (ranked A, listed first) is clearly the
        // one that key actually belongs to; picking whichever happens to
        // parse last would silently let a later, wrong entry win instead.
        if (!map.has(key)) map.set(key, entry);
    }
    return map;
}

async function fetchAndParse(url) {
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const { text } = await parser.getText();
    return parseCcfText(text);
}

async function readJSON(path) {
    try {
        return JSON.parse(await readFile(path, 'utf-8'));
    } catch {
        return null;
    }
}

async function lastFetchAgeMs() {
    try {
        const raw = await readFile(FETCHED_AT_FILE, 'utf-8');
        return Date.now() - new Date(raw.trim()).getTime();
    } catch {
        return Infinity; // no marker yet -- treat as "never fetched"
    }
}

// Unlike corePortal.js's load() (which refuses to boot with no CORE data
// at all), CCF is an opt-in alternative ranking source, not the default --
// a failed fetch with no local snapshot for a given edition just leaves
// that edition out of `editions` (or, if every edition fails, `editions`
// empty and every CCF lookup resolving to "no match") rather than failing
// the whole app's startup.
export async function load() {
    const loaded = [];
    try {
        await mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('[ccf] Could not create data directory:', error.message);
    }

    for (const { year, url } of HISTORICAL_EDITIONS) {
        const file = historicalEntriesFile(year);
        let list = await readJSON(file);
        if (list) {
            console.log(`[ccf] Using local snapshot for the ${year} edition (${list.length} entries)`);
        } else {
            try {
                console.log(`[ccf] Fetching ${year} edition (one-time -- past editions never change once superseded)...`);
                list = await fetchAndParse(url);
                await writeFile(file, JSON.stringify(list), 'utf-8');
                console.log(`[ccf] Loaded ${year} edition: ${list.length} entries`);
            } catch (error) {
                console.error(`[ccf] Could not fetch/parse the ${year} edition, it will be skipped:`, error.message);
                continue;
            }
        }
        loaded.push({ year, entries: list, byDblpKey: buildIndex(list) });
    }

    try {
        const age = await lastFetchAgeMs();
        let current = age < REFRESH_INTERVAL_MS ? await readJSON(ENTRIES_FILE) : null;
        if (current) {
            console.log(`[ccf] Using local snapshot for the current (${CURRENT_EDITION_YEAR}) edition (${Math.round(age / 86400000)}d old, ${current.length} entries)`);
        } else {
            console.log('[ccf] Fetching official CCF recommended list...');
            current = await fetchAndParse(PDF_URL);
            await writeFile(ENTRIES_FILE, JSON.stringify(current), 'utf-8');
            await writeFile(FETCHED_AT_FILE, new Date().toISOString(), 'utf-8');
            console.log(`[ccf] Loaded current (${CURRENT_EDITION_YEAR}) edition: ${current.length} entries`);
        }
        loaded.push({ year: CURRENT_EDITION_YEAR, entries: current, byDblpKey: buildIndex(current) });
    } catch (error) {
        console.error('[ccf] Could not fetch/parse the current list, falling back to its local snapshot if any:', error.message);
        const stored = await readJSON(ENTRIES_FILE);
        if (stored) loaded.push({ year: CURRENT_EDITION_YEAR, entries: stored, byDblpKey: buildIndex(stored) });
    }

    loaded.sort((a, b) => b.year - a.year); // newest first, mirrors corePortal.js's resolveSource
    editions = loaded;
    if (editions.length === 0) {
        console.error('[ccf] No CCF data available at all -- CCF-sourced rank lookups will all report "no match" until the next successful fetch.');
    }
}

// source is plain 'CCF' here (no edition year) since this base object is
// also used by early-exit paths that never resolved a specific edition at
// all (an unparseable dblp url, or no CCF data loaded yet) -- every path
// that *does* know which edition it looked in overrides this with
// `CCF${edition.year}`. Either way it always starts with 'CCF', which is
// what the front end's own source?.startsWith('CCF') portal check (see
// Publications.js/HalPublications.js) relies on.
const NO_MATCH = { value: 'Unranked', matchType: 'none', source: 'CCF', queryText: null };

// The rank in the *current* edition for the same venue -- a genuine
// then-vs-now comparison once a publication's own edition (resolved by
// year) differs from the latest one, exactly what CORE/SJR's own
// attachCurrentValue already shows. Undefined (not set at all) when the
// venue matched by `matcher` isn't in the current edition, same as
// CORE/SJR leaving currentValue unset on a lookup miss.
function attachCurrentValue(result, matcher) {
    const latest = editions[0];
    if (!latest) return result;
    const found = matcher(latest);
    if (!found) return result;
    return { ...result, currentSource: `CCF${latest.year}`, currentValue: found.rank };
}

// dblp-sourced publications carry their own dblp url already -- exact
// prefix match against CCF's own dblp reference per entry, no fuzzy
// matching needed once both sides agree on the same dblp key. pubYear
// picks which edition to match against (see resolveEdition) -- the one
// that was actually current when the publication came out.
export async function getRankForDblpUrl(dblpUrl, pubYear) {
    const key = dblpKeyFromUrl(dblpUrl);
    if (!key) return { ...NO_MATCH, queryText: dblpUrl };
    const edition = resolveEdition(pubYear);
    if (!edition) return { ...NO_MATCH, queryText: key };
    const cacheKey = rankKey(edition.year, key);
    const cached = await cache.get(cacheKey);
    if (cached !== null) return cached;

    return dedupeInFlight(inFlightByKey, cacheKey, async () => {
        const entry = edition.byDblpKey.get(key);
        const result = entry
            ? { value: entry.rank, matchType: 'exact', source: `CCF${edition.year}`, matchedTitle: entry.text, queryText: key }
            : { ...NO_MATCH, queryText: key, source: `CCF${edition.year}` };
        const withCurrent = attachCurrentValue(result, (latest) => latest.byDblpKey.get(key));
        await cache.set(cacheKey, withCurrent);
        return withCurrent;
    });
}
const inFlightByKey = new Map();

// Free-text search over one edition's CCF list, for RankDetailsPopover's
// "change match" picker -- same shape/contract as core.controllerCandidates/
// sjr.controllerCandidates (id/title/value per result). year picks the
// edition the same way the rank lookups above do, so searching lines up
// with whichever edition that publication's own automatic match used.
export function controllerCandidates(req, res) {
    const q = (req.query.q || '').trim().toLowerCase();
    const pubYear = Number(req.query.year) || CURRENT_EDITION_YEAR;
    const edition = resolveEdition(pubYear);
    if (q.length < 2 || !edition) {
        res.json({ source: edition ? `CCF${edition.year}` : 'CCF', results: [] });
        return;
    }
    const words = q.split(/\s+/).filter(Boolean);
    const results = edition.entries
        .filter(entry => {
            const haystack = entry.text.toLowerCase();
            return words.every(w => haystack.includes(w));
        })
        .slice(0, 50)
        .map(entry => ({ id: dblpKeyFromUrl(entry.url) ?? entry.url, title: entry.text, value: entry.rank }));
    res.json({ source: `CCF${edition.year}`, results });
}

const MAX_FUZZY_DISTANCE = 2;

function bestFuzzyMatch(edition, normalizedQuery) {
    let best = null;
    for (const entry of edition.entries) {
        const distance = levenshtein(normalizeTitle(entry.text), normalizedQuery);
        if (distance <= MAX_FUZZY_DISTANCE && (!best || distance < best.distance)) {
            best = { entry, distance };
        }
    }
    return best;
}

// HAL publications don't carry a dblp url -- fall back to fuzzy-matching
// the venue's own acronym/full name against CCF's combined text blob per
// entry, the same style of fallback corePortal.js's own fuzzy path uses.
// pubYear picks the edition, same as getRankForDblpUrl above.
export async function getRankForHalVenue(acronym, fullName, pubYear) {
    const queryText = [acronym, fullName].filter(Boolean).join(' ');
    if (!queryText) return { ...NO_MATCH, queryText };
    const edition = resolveEdition(pubYear);
    if (!edition) return { ...NO_MATCH, queryText };
    const cacheKey = rankKey(edition.year, queryText);
    const cached = await cache.get(cacheKey);
    if (cached !== null) return cached;

    return dedupeInFlight(inFlightByKey, cacheKey, async () => {
        const normalizedQuery = normalizeTitle(queryText);
        const best = bestFuzzyMatch(edition, normalizedQuery);
        // See isWorkshopMismatch's own comment (levenshtein.js) -- a
        // workshop's own title very often differs from its unrelated host
        // conference's by only the word "workshop" itself, well within
        // MAX_FUZZY_DISTANCE's tolerance. A distance-0 match can never
        // trigger this: the normalized word sequences are identical, so
        // matchedText already says "workshop" whenever queryText does.
        const result = best && !isWorkshopMismatch(queryText, best.entry.text)
            ? { value: best.entry.rank, matchType: 'fuzzy', source: `CCF${edition.year}`, matchedTitle: best.entry.text, distance: best.distance, queryText }
            : { ...NO_MATCH, queryText, source: `CCF${edition.year}` };
        const withCurrent = attachCurrentValue(result, (latest) => bestFuzzyMatch(latest, normalizedQuery)?.entry);
        await cache.set(cacheKey, withCurrent);
        return withCurrent;
    });
}

export default { load, getRankForDblpUrl, getRankForHalVenue, controllerCandidates, parseCcfText, dblpKeyFromUrl, rankKey, PDF_URL };
