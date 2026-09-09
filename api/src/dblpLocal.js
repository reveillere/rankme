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

    const publications = [
        ...inproceedings.map(doc => toPublication(doc, 'inproceedings')),
        ...articles.map(doc => toPublication(doc, 'article')),
    ];
    publications.sort((a, b) => (parseInt(b.dblp.year, 10) || 0) - (parseInt(a.dblp.year, 10) || 0));
    return publications;
}

function toPublication(doc, type) {
    // Co-author names carry no pid in this dump (see getAuthorNames) -- an
    // empty `$` (attributes) object, matching xml2js's shape for a plain
    // author element with no attributes, means Publications.js's own
    // `a.$.pid` check naturally finds none and renders plain text instead
    // of a (dead) link, exactly as wanted: no hyperlink when the local
    // extraction can't back one up.
    const authors = toArray(doc.author).map(name => ({ $: {}, _: name }));
    return {
        type,
        venue: firstOf(type === 'inproceedings' ? doc.booktitle : doc.journal),
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
