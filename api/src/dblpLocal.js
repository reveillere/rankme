import { getClient } from './db.js';

function toArray(value) {
    if (value == null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

// A field that repeats within one record (see admin.js's processXML) comes
// back as an array; some fields here are only ever used as a single value.
function firstOf(value) {
    return Array.isArray(value) ? value[0] : value;
}

async function getDb() {
    const client = await getClient();
    return client.db('dblp');
}

const HOMEPAGE_PREFIX = 'homepages/';

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lowercased, accent-stripped words from a name -- e.g. "Cyril Gavoille" ->
// ["cyril", "gavoille"], "Réveillère" -> ["reveillere"]. Shared between
// buildAuthorNameTokens (which stores this as each www record's own
// authorTokens field, across every name variant it has -- see
// getAuthorNames) and searchAuthorsByName (which tokenizes the query the
// same way to match against it).
export function tokenizeName(name) {
    return String(name)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

// Name search over the local dump, replacing the live dblp.org search API
// (dblp.js's searchAuthor/getSearchAuthor -- left intact, just unplugged
// for now, see the note on controllerSearch) so "search author by name" on
// the DBLP tab keeps working without any network access.
//
// Matches on individual name words, not just a prefix of the whole string
// -- "Gavoille" alone must find "Cyril Gavoille" -- via the authorTokens
// field (see buildAuthorNameTokens): every word in the query must prefix-
// match some token from some name variant on the record (AND across query
// words, OR across variants/tokens within each word). Restricted to actual
// person homepage records (the www collection also holds non-person web
// resources -- see the DTD notes in admin.js -- which start with a
// different key prefix and must not show up here as if they were people).
//
// No affiliation data is extracted from the dump for this (DBLP does carry
// it sometimes, as a <note type="affiliation"> on the person's own www
// record, but this app doesn't capture element attributes below the
// record root yet -- see processXML) -- always empty, matching what
// Search.js's rendering already treats as "nothing to show" rather than
// leaving a gap in the API-compatible shape it expects.
export async function searchAuthorsByName(query, limit = 20) {
    const words = tokenizeName(query);
    if (words.length === 0) return [];
    const db = await getDb();
    const docs = await db.collection('www')
        .find({
            // _id is the same value as `key` (see admin.js's processXML)
            // but always indexed by default, unlike `key` itself.
            _id: { $regex: `^${HOMEPAGE_PREFIX}` },
            authorTokens: { $all: words.map(w => new RegExp('^' + escapeRegex(w))) },
        })
        .limit(limit)
        .toArray();
    return docs.map(doc => ({
        author: firstOf(doc.author),
        pid: doc._id.slice(HOMEPAGE_PREFIX.length),
        affiliation: [],
    }));
}

// Resolves a DBLP PID (e.g. "07/1990") to every name variant that person's
// own homepage record in the local dump lists them under -- dblp merges
// name changes/spelling variants onto the same www/homepages/<pid> record
// specifically so they can all be matched back to one identity. Returns
// null when the dump has no such record (unknown PID, or the dump hasn't
// been imported yet), [] when the record exists but is empty.
export async function getAuthorNames(pid) {
    const db = await getDb();
    // _id (not the `key` field) -- see the note in searchAuthorsByName.
    const person = await db.collection('www').findOne({ _id: `${HOMEPAGE_PREFIX}${pid}` });
    if (!person) return null;
    return toArray(person.author).filter(Boolean);
}

// Every inproceedings/article record whose author list contains any of this
// person's known name variants, shaped the same way dblp.js's
// normalizePublications shapes a live-fetched author's publications so
// Publications.js/Author.js need no changes to render either source.
//
// No pid is stored per co-author in the bulk dump (unlike dblp.org's live
// per-person XML export, which annotates co-authors it can resolve) -- see
// getAuthorNames -- so this is a best-effort match on exact name text,
// relying on dblp's own upstream disambiguation (colliding names get a
// trailing "0001"/"0002"... suffix at the source) rather than anything
// this app adds on top.
export async function getPublicationsByNames(names) {
    if (!names || names.length === 0) return [];
    const db = await getDb();
    const [inproceedings, articles] = await Promise.all([
        db.collection('inproceedings').find({ author: { $in: names } }).toArray(),
        db.collection('article').find({ author: { $in: names } }).toArray(),
    ]);

    // Every co-author appearing anywhere in this author's own publications,
    // resolved to a pid in one batched query -- not one lookup per
    // publication/co-author -- see resolveAuthorPids.
    const coAuthorNames = new Set();
    for (const doc of inproceedings) toArray(doc.author).forEach(n => coAuthorNames.add(n));
    for (const doc of articles) toArray(doc.author).forEach(n => coAuthorNames.add(n));
    const pidByName = await resolveAuthorPids([...coAuthorNames]);

    const publications = [
        ...inproceedings.map(doc => toPublication(doc, 'inproceedings', pidByName)),
        ...articles.map(doc => toPublication(doc, 'article', pidByName)),
    ];
    publications.sort((a, b) => (parseInt(b.dblp.year, 10) || 0) - (parseInt(a.dblp.year, 10) || 0));
    return publications;
}

// Resolves each of `names` (exact co-author strings, as they appear
// verbatim in an inproceedings/article record's <author> field) to the pid
// of the www/homepages record listing it as one of its own name variants
// (see getAuthorNames) -- a person can be looked up this way regardless of
// which of their own name variants a given paper credits them under.
//
// Exact string match, not fuzzy: dblp's own bulk export already
// disambiguates colliding names at the source (a trailing "0001"/"0002"...
// suffix), so the same exact string reliably identifies the same person --
// no extra disambiguation needed on this end (see getPublicationsByNames).
// Needs www.author indexed (see admin.js's ensureIndexes) -- without it
// this would be a full scan of the ~4.2M www collection on every author
// page load.
async function resolveAuthorPids(names) {
    if (names.length === 0) return new Map();
    const db = await getDb();
    const nameSet = new Set(names);
    const docs = await db.collection('www')
        .find({ _id: { $regex: `^${HOMEPAGE_PREFIX}` }, author: { $in: names } }, { projection: { author: 1 } })
        .toArray();
    const pidByName = new Map();
    for (const doc of docs) {
        const pid = doc._id.slice(HOMEPAGE_PREFIX.length);
        for (const name of toArray(doc.author)) {
            if (nameSet.has(name)) pidByName.set(name, pid);
        }
    }
    return pidByName;
}

function toPublication(doc, type, pidByName) {
    // A co-author whose name couldn't be resolved to a pid (see
    // resolveAuthorPids -- e.g. no matching homepages record, or this
    // publication predates the dump's own name-merge for that person)
    // gets an empty `$` (attributes) object, matching xml2js's shape for a
    // plain author element with no attributes: Publications.js's own
    // `a.$.pid` check naturally finds none and renders plain text instead
    // of a (dead) link.
    const authors = toArray(doc.author).map(name => {
        const pid = pidByName?.get(name);
        return { $: pid ? { pid } : {}, _: name };
    });
    // dblp models a CoRR/arXiv report as a regular <article> (journal=
    // "CoRR") -- structurally a journal entry, but not a peer-reviewed one,
    // so no SJR quartile is meaningful for it and showing it alongside
    // real journal articles is misleading. Reclassified as 'informal'
    // (dblpCategories' own bucket for this, front/src/dblp.js) here, at
    // the one place every dblp article gets shaped for the front end --
    // that also takes it out of SJR ranking entirely, since
    // authorStream.js's isRankable filter only matches 'inproceedings'/
    // 'article'.
    const isCoRR = type === 'article' && firstOf(doc.journal) === 'CoRR';
    const effectiveType = isCoRR ? 'informal' : type;
    return {
        type: effectiveType,
        venue: firstOf(effectiveType === 'inproceedings' ? doc.booktitle : doc.journal),
        authors,
        dblp: {
            ...doc,
            title: firstOf(doc.title),
            // <url> is optional per the DTD; <key> (the record's own
            // identifier) is always present, and unique -- a safe
            // fallback so every publication still has a stable value
            // here (used as the React list key and, on the live-fetch
            // path, as the ref for further lookups).
            url: firstOf(doc.url) || doc.key,
        },
    };
}
