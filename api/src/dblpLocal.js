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

// Batched sibling of getAuthorNames above -- one $in query over every pid
// instead of a per-pid round-trip. A pid absent from the dump is simply
// absent from the returned Map (unlike getAuthorNames, which returns null
// for it) since every caller here only ever needs the names that do exist.
export async function getAuthorNamesByPids(pids) {
    if (pids.length === 0) return new Map();
    const db = await getDb();
    const docs = await db.collection('www').find(
        { _id: { $in: pids.map(pid => `${HOMEPAGE_PREFIX}${pid}`) } },
        { projection: { author: 1 } },
    ).toArray();
    return new Map(docs.map(doc => [doc._id.slice(HOMEPAGE_PREFIX.length), toArray(doc.author).filter(Boolean)]));
}

// ORCID is not a dedicated dblp field: it's one of several URLs (alongside
// Google Scholar/ACM/IEEE/...) on a person's own www/homepages/<pid> record,
// recognizable only by its https://orcid.org/ prefix. Observed to appear at
// most once per record, but this doesn't crash if that ever changes -- it
// just returns the first one found. Exported so identityResolution.js
// shares this one implementation instead of a second, possibly-drifting copy.
const ORCID_URL = /orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;

export function extractOrcid(url) {
    for (const candidate of toArray(url)) {
        if (typeof candidate !== 'string') continue;
        const match = ORCID_URL.exec(candidate);
        if (match) return match[1];
    }
    return null;
}

// pid's own ORCID, read off the same homepage record getAuthorNames reads --
// a second query (not folded into getAuthorNames itself) since most callers
// of getAuthorNames never need it, and this is cheap on its own (single
// indexed _id lookup, url-only projection).
export async function getAuthorOrcid(pid) {
    const db = await getDb();
    const person = await db.collection('www').findOne({ _id: `${HOMEPAGE_PREFIX}${pid}` }, { projection: { url: 1 } });
    return person ? extractOrcid(person.url) : null;
}

// Reverse of extractOrcid above: given a bare ORCID (no https://orcid.org/
// prefix -- the same bare form extractOrcid itself returns, and the form
// hal.js's own orcidId_s is stored in), find the dblp homepage record whose
// <url> carries it.
//
// There is no index on `url` (unlike `author`/`authorTokens`, see
// admin.js's ensureIndexes), so this is a full scan of the ~4.2M-doc www
// collection -- measured at ~5s in a previous session. That cost is exactly
// why a reverse ORCID scan was ruled out as a LAB-WIDE resolution path (see
// identityResolution.js's own module header: hundreds of members, hundreds
// of 5s scans). This function is different: identityResolution.js's
// resolveDblpIdentityForIdHal calls it for exactly ONE person at a time, on
// demand (a single "Cross-check with DBLP" click) -- paying 5s once,
// interactively, is acceptable and explicitly in scope there.
//
// No $elemMatch needed: Mongo already matches a regex against an array
// field element-wise for a single-condition query like this one (only a
// query needing more than one condition to hold on the SAME array element
// would need $elemMatch).
export async function findAuthorByOrcid(orcid) {
    const db = await getDb();
    const doc = await db.collection('www').findOne(
        { _id: { $regex: `^${HOMEPAGE_PREFIX}` }, url: new RegExp(escapeRegex(orcid)) },
        { projection: { author: 1 } },
    );
    if (!doc) return null;
    return { pid: doc._id.slice(HOMEPAGE_PREFIX.length), name: firstOf(doc.author) };
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
// `skipCoAuthorResolution` skips the resolveAuthorPids fan-out over the
// ~14k-doc www collection (~0.9s) entirely -- worth it for a caller (e.g.
// crosscheck.js) that never renders co-author links and would otherwise pay
// for a lookup whose result it throws away. Field projection is likewise
// narrowed to what such a caller actually reads (toPublication's dblp
// shape); default behavior (no options) is unchanged for every other
// caller, which still needs full docs and resolved pids.
export async function getPublicationsByNames(names, { skipCoAuthorResolution = false } = {}) {
    if (!names || names.length === 0) return [];
    const db = await getDb();
    const projection = skipCoAuthorResolution
        ? { projection: { title: 1, year: 1, booktitle: 1, journal: 1, ee: 1, key: 1, author: 1 } }
        : {};
    const [inproceedings, articles] = await Promise.all([
        db.collection('inproceedings').find({ author: { $in: names } }, projection).toArray(),
        db.collection('article').find({ author: { $in: names } }, projection).toArray(),
    ]);

    let pidByName;
    if (skipCoAuthorResolution) {
        pidByName = new Map();
    } else {
        // Every co-author appearing anywhere in this author's own
        // publications, resolved to a pid in one batched query -- not one
        // lookup per publication/co-author -- see resolveAuthorPids.
        const coAuthorNames = new Set();
        for (const doc of inproceedings) toArray(doc.author).forEach(n => coAuthorNames.add(n));
        for (const doc of articles) toArray(doc.author).forEach(n => coAuthorNames.add(n));
        pidByName = await resolveAuthorPids([...coAuthorNames]);
    }

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
        // Used to spread the entire raw Mongo document here (`...doc`) --
        // every stray DTD field a record happens to carry (note, crossref,
        // cite, editor, series, address, mdate, key, ...), most of them
        // never read anywhere. Harmless per publication, but this object is
        // sent as-is to the client in streamRankedItems' `init` event for
        // *every* publication up front -- for a prolific author or, via
        // getPublicationsByNames, a large co-author list, that's thousands
        // of oversized objects inflating the SSE payload for fields nothing
        // ever displays. Projected down to exactly what Publications.js's
        // Venue/PublicationRow render and authorStream.js's ranking path
        // reads (year, ee -- see extractDoi).
        dblp: {
            title: firstOf(doc.title),
            year: firstOf(doc.year),
            // The record's own <key> attribute, always present and unique
            // per the DTD -- unlike <url> below, which is NOT reliably
            // unique: DBLP groups some records under a shared bibliography
            // page (e.g. several different RFCs all point to the same
            // "journals/rfc/rfc6800-6899.html"), so two distinct
            // publications can carry the identical url. Publications.js's
            // Virtuoso list used url as its React/computeItemKey value --
            // a genuine collision there breaks Virtuoso's row recycling
            // (confirmed live: rankme.fr/dblp/91/2043 showed one row's
            // content repeated across many positions while scrolling,
            // traced to exactly this RFC range-page collision). key is
            // what's actually unique; use it for identity.
            key: doc.key,
            // <url> is optional per the DTD -- doc.key as a fallback here
            // keeps this field itself always populated, but see the `key`
            // field above for anything that needs actual uniqueness.
            url: firstOf(doc.url) || doc.key,
            // <ee> can repeat per the DTD (e.g. a DOI link alongside an
            // arXiv mirror) -- left as whatever shape doc.ee already is
            // (string or array), since both findDoiUrl (Publications.js)
            // and crossref.extractDoi (authorStream.js) already handle
            // either.
            ee: doc.ee,
            pages: firstOf(doc.pages),
            volume: firstOf(doc.volume),
            number: firstOf(doc.number),
            journal: firstOf(doc.journal),
            publisher: firstOf(doc.publisher),
            isbn: firstOf(doc.isbn),
        },
    };
}
