import * as cache from './cache.js';

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

export async function getAuthorPublications(id) {
    const key = `hal:author:${id}`;

    let publications = await cache.get(key);
    if (publications == null) {
        publications = await fetchAuthorPublications(id);
        cache.set(key, publications, 60 * 60 * 24); // 1 day
    }
    return publications;
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
    const fields = 'docid,title_s,docType_s,publicationDateY_i,conferenceTitle_s,journalTitle_s,authFullName_s,authIdHalFullName_fs,uri_s';
    const url = `${BASE}/search/?q=${encodeURIComponent(filter)}&rows=1000&wt=json&fl=${fields}&sort=${encodeURIComponent('publicationDateY_i desc')}`;

    const resp = await fetch(url);
    const data = await resp.json();
    const docs = data?.response?.docs || [];

    return docs.map(doc => ({
        docid: doc.docid,
        title: Array.isArray(doc.title_s) ? doc.title_s[0] : doc.title_s,
        type: doc.docType_s,
        year: doc.publicationDateY_i,
        venue: doc.conferenceTitle_s || doc.journalTitle_s || null,
        authors: parseAuthors(doc),
        url: doc.uri_s,
    }));
}
