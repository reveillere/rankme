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

    // Two levels of merging, both needed (verified against a live case: a
    // search for "Leo Mendiboure" returning 5 raw docs for this one person).
    //
    // Level 1 -- each HAL "form" (person record) may appear twice: once as
    // the PREFERRED entry (with idHal_s) and once as a bare INCOMING
    // duplicate of the exact same form_i. Merge those first, preferring the
    // one with idHal_s.
    const byForm = new Map();
    for (const doc of docs) {
        if (!doc.fullName_s) continue;
        const existing = byForm.get(doc.form_i);
        if (!existing || (!existing.idHal_s && doc.idHal_s)) {
            byForm.set(doc.form_i, doc);
        }
    }
    // Level 2 -- two DISTINCT form_i can still share the same idHal_s once
    // HAL has administratively merged them (the live case: "Léo Mendiboure"
    // form 1799832 and "Leo Mendiboure" form 1788332 both resolve to idHal_s
    // "leo-mendiboure") -- level 1 alone left both standing since they never
    // shared a form_i to merge on. A form with no idHal_s at all (never
    // claimed) has no shared identity to merge on beyond level 1, so it
    // keeps its own form_i as the key here.
    const byIdentity = new Map();
    for (const doc of byForm.values()) {
        const key = doc.idHal_s || `form:${doc.form_i}`;
        if (!byIdentity.has(key)) byIdentity.set(key, doc);
    }

    return [...byIdentity.values()].map(doc => ({
        author: doc.fullName_s,
        id: doc.idHal_s || `form:${doc.form_i}`,
        affiliation: doc.emailDomain_s || [],
    }));
}

// ****************************************************************************************************
// ****************************************************************************************************

export async function controllerAuthorInfo(req, res) {
    const id = req.params[0];
    try {
        const info = await getAuthorInfo(id);
        res.json(info);
    } catch (error) {
        console.log('Error during HAL author-info computation', error);
        res.status(400).json({ error: error.message });
    }
}

// idHal + ORCID for a single HAL identity -- distinct from ref/author's own
// authORCIDIdExt_s (present on *publication* records, one array per doc with
// no reliable alignment to the author list). ref/author's own orcidId_s is
// attached to a specific idHal_s instead, only ever present when that person
// has actually linked an ORCID to their HAL account.
export async function getAuthorInfo(idHal) {
    const key = `hal:author-info:${idHal}`;

    let info = await cache.get(key);
    if (info == null) {
        info = await fetchAuthorInfo(idHal);
        cache.set(key, info, 60 * 60 * 24); // 1 day, same as searchAuthor
    }
    return info;
}

async function fetchAuthorInfo(idHal) {
    const fields = 'idHal_s,orcidId_s';
    const url = `${BASE}/ref/author/?q=idHal_s:${encodeURIComponent(idHal)}&wt=json&rows=1&fl=${fields}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const doc = data?.response?.docs?.[0];

    return { idHal, orcid: doc?.orcidId_s?.[0] || null };
}

// Reverse lookup of getAuthorInfo above: given a bare ORCID (no
// https://orcid.org/ prefix -- orcidId_s itself is stored bare, unlike
// dblp's own url field), find the HAL identity that claims it, if any.
// Used by identityResolution.js's /identity/suggest/:pid to propose a HAL
// identity for a dblp author from their dblp-side ORCID alone, without
// requiring them to already be a known lab member (unlike
// resolveStructure, which only ever looks at one structure's membership).
export async function findAuthorByOrcid(orcid) {
    const key = `hal:orcid-lookup:${orcid}`;

    // Same false-vs-null cache convention as getStructureInfo above: `null`
    // is a legitimate "no HAL identity claims this ORCID" result, so a plain
    // `== null` check here would re-fetch on every call for an author who
    // simply has no HAL account.
    let info = await cache.get(key);
    if (info === null) {
        const found = await fetchAuthorByOrcid(orcid);
        info = found || false;
        cache.set(key, info, 60 * 60 * 24); // 1 day, same as getAuthorInfo
    }
    return info || null;
}

async function fetchAuthorByOrcid(orcid) {
    const fields = 'idHal_s,fullName_s';
    const url = `${BASE}/ref/author/?q=orcidId_s:${encodeURIComponent(`"${orcid}"`)}&wt=json&rows=1&fl=${fields}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const doc = data?.response?.docs?.[0];

    return doc?.idHal_s ? { idHal: doc.idHal_s, name: doc.fullName_s } : null;
}

// Batched sibling of getAuthorInfo above, for identityResolution.js: a lab's
// membership can run into the hundreds of idHal_s, and looking each one up
// individually would serialize hundreds of Solr round-trips behind the
// shared throttler (throttler.js's default_limiter is maxConcurrent:1).
// Chunking 100 idHal_s per query (measured ~0.2s/batch against HAL) keeps
// this a handful of requests instead. Cached per idHal (not per batch) so a
// later call needing only some of the same idHals still gets cache hits.
//
// Returns a Map<idHal, orcid[]> -- plural, unlike getAuthorInfo's single
// `orcid`: orcidId_s has been observed carrying more than one entry for a
// single idHal_s (a person with duplicated/merged HAL forms), and
// identityResolution.js needs the full set to check for any overlap with
// dblp's own extracted ORCID, not just the first value.
const AUTHOR_INFO_BATCH_SIZE = 100;

export async function getAuthorsInfo(idHals) {
    const result = new Map();
    if (idHals.length === 0) return result;

    const keys = idHals.map(idHal => `hal:orcid-batch:${idHal}`);
    const cached = await cache.mget(keys);
    const uncached = idHals.filter((idHal, i) => !cached.has(keys[i]));
    idHals.forEach((idHal, i) => {
        if (cached.has(keys[i])) result.set(idHal, cached.get(keys[i]));
    });

    for (let i = 0; i < uncached.length; i += AUTHOR_INFO_BATCH_SIZE) {
        const batch = uncached.slice(i, i + AUTHOR_INFO_BATCH_SIZE);
        const orcidsByIdHal = await fetchAuthorsInfoBatch(batch);
        for (const idHal of batch) {
            const orcids = orcidsByIdHal.get(idHal) || [];
            result.set(idHal, orcids);
            cache.set(`hal:orcid-batch:${idHal}`, orcids, 60 * 60 * 24); // 1 day, same as getAuthorInfo
        }
    }
    return result;
}

async function fetchAuthorsInfoBatch(idHals) {
    const fields = 'idHal_s,orcidId_s';
    const idHalQuery = idHals.map(id => `"${id}"`).join(' OR ');
    const url = `${BASE}/ref/author/?q=idHal_s:${encodeURIComponent(`(${idHalQuery})`)}&wt=json&rows=${idHals.length}&fl=${fields}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    const orcidsByIdHal = new Map();
    for (const doc of docs) {
        if (doc.idHal_s) orcidsByIdHal.set(doc.idHal_s, doc.orcidId_s || []);
    }
    return orcidsByIdHal;
}

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

async function fetchPublicationsByFilter(filter, { extraFields, onDoc } = {}) {
    const fields = `docid,title_s,docType_s,publicationDateY_i,conferenceTitle_s,journalTitle_s,authFullName_s,authIdHalFullName_fs,uri_s,doiId_s,arxivId_s${extraFields ? `,${extraFields}` : ''}`;
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
            // Raw doc, before the clean-shape mapping below strips whatever
            // extraFields asked for -- the only place a caller can still
            // see e.g. authIdHasStructure_fs (see fetchStructurePublications).
            onDoc?.(doc);
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
        // Bare id (e.g. "0809.2679"), occasionally vN-suffixed -- confirmed
        // live against HAL's API. Used by crosscheck.js to exact-match
        // against a dblp CoRR/arXiv entry when there's no DOI on either side.
        arxivId: doc.arxivId_s || null,
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
        const { publications } = await getStructurePublications(id);
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

// Returns { publications, memberIds } -- memberIds is every idHal found to
// be personally affiliated with this structure (see structureMembersOf),
// computed in the same paginated pass as the publications themselves so
// this never costs an extra HAL round-trip.
// Cache key bumped to v2: pre-existing `hal:structure:<id>` entries (up to a
// day old) hold the old shape (a bare publications array, no memberIds) --
// `{ publications, memberIds } = <array>` destructures `publications` as
// undefined, crashing rankHalPublications -- a version bump avoids waiting
// out that day-long TTL on deploy.
export async function getStructurePublications(id) {
    const key = `hal:structure:v2:${id}`;

    const cached = await cache.get(key);
    if (cached !== null) return cached;

    return dedupeInFlight(inFlightStructurePublications, key, async () => {
        const result = await fetchStructurePublications(id);
        // Awaited -- see getAuthorPublications above.
        await cache.set(key, result, 60 * 60 * 24); // 1 day
        return result;
    });
}

// A publication tagged structId_i:X can still have co-authors from a
// completely different institution (a paper is "affiliated with X" as soon
// as *any* author is, see fetchStructurePublications below) -- so knowing
// who's actually a member of X, as opposed to just a co-author on one of
// its papers, needs each author's OWN affiliations, not the document's.
// authIdHasStructure_fs carries exactly that: one entry per (author,
// structure they're personally affiliated with) pair, e.g.
// "<authIdFormPerson>_FacetSep_<authFullName>_JoinSep_<structId>_FacetSep_<structName>"
// -- verified live against HAL's API (a doc with 3 co-authors, only 2 of
// them affiliated with LaBRI, correctly listed structId 3102 only under
// those 2's own entries). authIdFormPerson_s/authIdHalFullName_fs are
// aligned parallel arrays (same index = same author, confirmed the same
// way) -- the join key between the two facets is authIdFormPerson, not
// idHal, since not every author has claimed a HAL account (parseAuthors's
// own idHal-may-be-empty handling applies here identically).
function structureMembersOf(doc, structId) {
    const target = String(structId);
    const affiliatedFormPersons = new Set();
    for (const entry of doc.authIdHasStructure_fs || []) {
        const joinIdx = entry.indexOf('_JoinSep_');
        if (joinIdx < 0) continue;
        const formPerson = entry.slice(0, entry.indexOf('_FacetSep_'));
        const sid = entry.slice(joinIdx + '_JoinSep_'.length).split('_FacetSep_')[0];
        if (sid === target) affiliatedFormPersons.add(formPerson);
    }
    if (affiliatedFormPersons.size === 0) return [];

    const formPersons = doc.authIdFormPerson_s || [];
    const idHalFacets = doc.authIdHalFullName_fs || [];
    const sep = '_FacetSep_';
    const members = [];
    formPersons.forEach((formPerson, i) => {
        if (!affiliatedFormPersons.has(formPerson)) return;
        const facet = idHalFacets[i] || '';
        const idHal = facet.includes(sep) ? facet.slice(0, facet.indexOf(sep)) : '';
        if (idHal) members.push(idHal);
    });
    return members;
}

async function fetchStructurePublications(structId) {
    const memberIds = new Set();
    const publications = await fetchPublicationsByFilter(`structId_i:${structId}`, {
        extraFields: 'authIdFormPerson_s,authIdHasStructure_fs',
        onDoc: (doc) => { for (const id of structureMembersOf(doc, structId)) memberIds.add(id); },
    });
    return { publications, memberIds: [...memberIds] };
}
