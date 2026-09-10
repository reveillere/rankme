import * as cache from './cache.js';
import { dedupeInFlight } from './inFlight.js';

import fetch from './throttler.js';

const BASE = 'https://api.archives-ouvertes.fr';

export async function controllerSearch(req, res) {
    const searchQuery = req.params[0];
    try {
        const results = await getSearchAuthor(searchQuery);
        res.json(results);
    } catch (error) {
        console.log('Error during HAL search computation', error);
        res.status(400).json({ error: error.message });
    }
}

async function getSearchAuthor(searchQuery) {
    const key = `hal:search:${searchQuery}`;

    let results = await cache.get(key);
    if (results == null) {
        results = await searchAuthor(searchQuery);
        cache.set(key, results, 60 * 60 * 24); // 1 day
    }
    return results;
}

export async function searchAuthor(searchQuery) {
    const fields = 'fullName_s,idHal_s,form_i,emailDomain_s';
    const url = `${BASE}/ref/author/?q=${encodeURIComponent(searchQuery)}&wt=json&rows=15&fl=${fields}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    // Each HAL "form" (person record) may appear twice: once as the
    // PREFERRED entry (with idHal_s) and once as a bare INCOMING duplicate.
    // Keep only one entry per form_i, preferring the one with idHal_s.
    const byForm = new Map();
    for (const doc of docs) {
        if (!doc.fullName_s) continue;
        const existing = byForm.get(doc.form_i);
        if (!existing || (!existing.idHal_s && doc.idHal_s)) {
            byForm.set(doc.form_i, doc);
        }
    }

    return [...byForm.values()].map(doc => ({
        author: doc.fullName_s,
        id: doc.idHal_s || `form:${doc.form_i}`,
        affiliation: doc.emailDomain_s || [],
    }));
}

// ****************************************************************************************************
// ****************************************************************************************************

export async function controllerAuthor(req, res) {
    const id = req.params[0];
    try {
        const publications = await getAuthorPublications(id);
        res.json(publications);
    } catch (error) {
        console.log('Error during HAL author computation', error);
        res.status(400).json({ error: error.message });
    }
}

// Two tabs opening the same author at once (both hitting a cold cache) would
// otherwise both page all the way through HAL's Solr results independently
// -- deduped via inFlightAuthorPublications (see dedupeInFlight) instead.
const inFlightAuthorPublications = new Map();

export async function getAuthorPublications(id) {
    const key = `hal:author:${id}`;

    const cached = await cache.get(key);
    if (cached !== null) return cached;

    return dedupeInFlight(inFlightAuthorPublications, key, async () => {
        const publications = await fetchAuthorPublications(id);
        // Awaited -- see corePortal.js's identical comment on its own
        // dedupeInFlight callers: without this, the map entry above is
        // cleared before the Redis write lands, leaving a gap where a
        // caller arriving just after can miss both and re-fetch anyway.
        await cache.set(key, publications, 60 * 60 * 24); // 1 day
        return publications;
    });
}

// authIdHalFullName_fs entries look like "<idHal_s>_FacetSep_<Full Name>",
// or "_FacetSep_<Full Name>" when the author has no claimed HAL account.
function parseAuthors(doc) {
    const facets = doc.authIdHalFullName_fs;
    if (Array.isArray(facets) && facets.length > 0) {
        const sep = '_FacetSep_';
        return facets.map(facet => {
            const idx = facet.indexOf(sep);
            const idHal = idx > 0 ? facet.slice(0, idx) : null;
            const name = idx >= 0 ? facet.slice(idx + sep.length) : facet;
            return { name, idHal };
        });
    }
    return (doc.authFullName_s || []).map(name => ({ name, idHal: null }));
}

async function fetchAuthorPublications(id) {
    const filter = id.startsWith('form:') ? `authIdForm_i:${id.slice(5)}` : `authIdHal_s:${id}`;
    return fetchPublicationsByFilter(filter);
}

// HAL's Solr backend silently caps `rows` at 10000 regardless of what's
// requested (a large lab like LaBRI has 10000+ records, well past that), so
// a single request can't fetch everything -- page through with `start`
// until a page comes back short, which is the only sign of "no more data"
// this API gives (numFound is somewhat unreliable/racy across pages).
const PAGE_SIZE = 10000;

async function fetchPublicationsByFilter(filter) {
    const fields = 'docid,title_s,docType_s,publicationDateY_i,conferenceTitle_s,journalTitle_s,authFullName_s,authIdHalFullName_fs,uri_s,doiId_s';
    // publicationDateY_i is only a YEAR -- thousands of docs share the same
    // value for a lab-sized structure, so it alone isn't a stable sort key
    // for deep `start`-based pagination: Solr is free to order same-year
    // ties differently between two separate requests (a large index can
    // shift slightly between them too), which showed up as ~17 publications
    // returned on *both* pages for LaBRI (10000+ records). docid is unique
    // and immutable, so appending it as a tiebreaker makes the ordering --
    // and therefore which docs land on which page -- fully deterministic.
    const sort = 'publicationDateY_i desc,docid asc';
    const docs = [];
    const seenDocids = new Set();
    for (let start = 0; ; start += PAGE_SIZE) {
        const url = `${BASE}/search/?q=${encodeURIComponent(filter)}&rows=${PAGE_SIZE}&start=${start}&wt=json&fl=${fields}&sort=${encodeURIComponent(sort)}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const page = data?.response?.docs || [];
        // Belt-and-suspenders on top of the tiebreaker above: still skip
        // any docid already seen (from an earlier page, or a genuine dup in
        // HAL's own index) rather than trust the fix to be airtight.
        for (const doc of page) {
            if (seenDocids.has(doc.docid)) continue;
            seenDocids.add(doc.docid);
            docs.push(doc);
        }
        if (page.length < PAGE_SIZE) break;
    }

    return docs.map(doc => ({
        docid: doc.docid,
        title: Array.isArray(doc.title_s) ? doc.title_s[0] : doc.title_s,
        type: doc.docType_s,
        year: doc.publicationDateY_i,
        venue: doc.conferenceTitle_s || doc.journalTitle_s || null,
        doi: doc.doiId_s || null,
        authors: parseAuthors(doc),
        url: doc.uri_s,
    }));
}

// ****************************************************************************************************
// ****************************************************************************************************
// A HAL "structure" is a lab/institution/team-like entity (see
// https://aurehal.archives-ouvertes.fr/structure/index) -- unlike an author
// search, this pulls every publication ever affiliated with it directly,
// with no separate membership list to maintain.

export async function controllerSearchStructure(req, res) {
    const searchQuery = req.params[0];
    try {
        const results = await getSearchStructure(searchQuery);
        res.json(results);
    } catch (error) {
        console.log('Error during HAL structure search computation', error);
        res.status(400).json({ error: error.message });
    }
}

async function getSearchStructure(searchQuery) {
    const key = `hal:structure-search:${searchQuery}`;

    let results = await cache.get(key);
    if (results == null) {
        results = await searchStructure(searchQuery);
        cache.set(key, results, 60 * 60 * 24); // 1 day
    }
    return results;
}

export async function searchStructure(searchQuery) {
    const fields = 'docid,label_s,acronym_s,valid_s';
    const url = `${BASE}/ref/structure/?q=${encodeURIComponent(searchQuery)}&wt=json&rows=15&fl=${fields}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    // valid_s is not simply valid/invalid: 'VALID' is the current entry,
    // 'OLD' is a real, still-queryable structure that was later superseded
    // or renamed (e.g. a defunct team like "Regal") -- excluding it would
    // make a real, searchable structure invisible by name (its own docid
    // still works fine). 'INCOMING' is the one status worth dropping: an
    // unverified/duplicate placeholder (address text, near-duplicate
    // entries) rather than a real structure record.
    return docs
        .filter(doc => doc.valid_s !== 'INCOMING' && doc.label_s)
        .map(doc => ({ name: doc.label_s, id: doc.docid, acronym: doc.acronym_s || null }));
}

// Looks up a single structure's own name by id -- used when a structure tab
// is opened without already knowing its name (typed in directly by id, or
// reloaded from a bare /structure/:id URL).
export async function controllerStructureInfo(req, res) {
    const id = req.params[0];
    try {
        const info = await getStructureInfo(id);
        if (!info) {
            res.status(404).json({ error: 'Not Found', message: `No HAL structure with id ${id}` });
            return;
        }
        res.json(info);
    } catch (error) {
        console.log('Error during HAL structure info lookup', error);
        res.status(400).json({ error: error.message });
    }
}

async function getStructureInfo(id) {
    const key = `hal:structure-info:${id}`;

    let info = await cache.get(key);
    if (info === null) {
        const fields = 'docid,label_s,acronym_s';
        const url = `${BASE}/ref/structure/?q=docid:${encodeURIComponent(id)}&wt=json&rows=1&fl=${fields}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const doc = data?.response?.docs?.[0];
        info = doc ? { name: doc.label_s, id: doc.docid, acronym: doc.acronym_s || null } : false;
        cache.set(key, info, 60 * 60 * 24); // 1 day
    }
    return info || null;
}

export async function controllerStructurePublications(req, res) {
    const id = req.params[0];
    try {
        const publications = await getStructurePublications(id);
        res.json(publications);
    } catch (error) {
        console.log('Error during HAL structure computation', error);
        res.status(400).json({ error: error.message });
    }
}

// Same race as getAuthorPublications above, and the one that actually
// prompted this fix: a lab-scale structure (LaBRI: 10000+ records, paged
// PAGE_SIZE at a time) opened in two tabs at once would otherwise double
// both the HAL fetch cost and the memory held by two independent copies of
// the full page set while they're in flight.
const inFlightStructurePublications = new Map();

export async function getStructurePublications(id) {
    const key = `hal:structure:${id}`;

    const cached = await cache.get(key);
    if (cached !== null) return cached;

    return dedupeInFlight(inFlightStructurePublications, key, async () => {
        const publications = await fetchStructurePublications(id);
        // Awaited -- see getAuthorPublications above.
        await cache.set(key, publications, 60 * 60 * 24); // 1 day
        return publications;
    });
}

async function fetchStructurePublications(structId) {
    return fetchPublicationsByFilter(`structId_i:${structId}`);
}
