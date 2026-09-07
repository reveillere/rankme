import * as cache from './cache.js';
import { normalizeTitle } from './levenshtein.js';

import fetch from './throttler.js';

const BASE = 'https://api.crossref.org';

// Crossref's own event/container metadata is far cleaner than HAL's
// free-text conferenceTitle_s (typed by the depositor at submission time),
// and it often carries an acronym HAL doesn't expose at all -- letting HAL
// publications use the same acronym-first CORE matching as DBLP publications
// instead of a pure fuzzy match over the whole ranking database.
export async function getVenueInfo(doi) {
    const key = `crossref:venue:${doi}`;

    let info = await cache.get(key);
    if (info == null) {
        info = await fetchVenueInfo(doi);
        cache.set(key, info, 60 * 60 * 24 * 90); // 90 days: published DOI metadata rarely changes
    }
    return info;
}

async function fetchVenueInfo(doi) {
    try {
        const resp = await fetch(`${BASE}/works/${encodeURIComponent(doi)}`);
        const data = await resp.json();
        const work = data?.message;
        if (!work) return null;

        // Springer records list the series name first, then the actual
        // proceedings/book title (e.g. ["Lecture Notes in Computer Science",
        // "Middleware 2012"]); ACM/IEEE records carry a single entry. The
        // real venue title is always the last one.
        const containerTitles = work['container-title'] || [];
        const fullName = containerTitles[containerTitles.length - 1] || work.event?.name || null;
        const acronym = extractAcronym(work, fullName);

        return (fullName || acronym) ? { fullName, acronym } : null;
    } catch (error) {
        console.log('[crossref] Error fetching venue info for', doi, ':', error.message);
        return null;
    }
}

// Prefer Crossref's own event.acronym (e.g. "EASE '15"), stripping the
// trailing year/edition marker so it lines up with CORE's bare acronym
// format (e.g. "EASE"). IEEE records rarely have a structured acronym field,
// but usually carry one parenthesised at the end of the container title or
// event name instead (e.g. "... (ICDCS)").
function extractAcronym(work, fullName) {
    const eventAcronym = work.event?.acronym;
    // For a paper published in a workshop co-located with a bigger
    // conference, Crossref sometimes tags the paper with the *host*
    // conference's event metadata instead of the workshop's own -- e.g. a
    // "Packet Video Workshop" paper carrying event.name "MMSys '18: ...".
    // Only trust event.acronym when the event name actually overlaps with
    // this record's own container title; otherwise fall back below.
    if (eventAcronym && sameVenue(work.event?.name, fullName)) {
        return eventAcronym.replace(/\s*'?\d{2,4}$/, '').trim().toUpperCase();
    }

    const candidates = [work.event?.name, ...(work['container-title'] || [])];
    for (const candidate of candidates) {
        const acronym = extractTrailingAcronym(candidate);
        if (acronym) return acronym;
    }
    return null;
}

// A single shared word isn't enough: a workshop's own title and its host
// conference's event name will often share one generic topic word (e.g.
// both "PLOS" and its host "SOSP" talk about "Operating Systems") without
// being the same venue at all. Require a majority of fullName's words to
// reappear in the event name before trusting event.acronym belongs to this
// record rather than to whatever it was co-located with.
function sameVenue(eventName, fullName) {
    if (!eventName || !fullName) return true; // nothing to cross-check against
    const eventWords = new Set(normalizeTitle(eventName));
    const fullNameWords = normalizeTitle(fullName);
    if (fullNameWords.length === 0) return true;
    const overlap = fullNameWords.filter(word => eventWords.has(word)).length;
    return overlap / fullNameWords.length > 0.5;
}

// A trailing parenthesised acronym, optionally followed by a year/edition
// marker inside the same parens (e.g. "(ICDCS)", "(COMPSAC 2013)",
// "(DSN-S)"). Only trusted when it was already upper-case in the source
// text, so an incidental descriptive aside -- e.g. "(revised)" -- doesn't
// get mistaken for one. Exported for authorStream.js to run over HAL's own
// raw venue text too, which very often already carries its own acronym this
// way even without a DOI/Crossref lookup.
export function extractTrailingAcronym(text) {
    if (!text) return null;
    const match = text.match(/\(([A-Za-z][A-Za-z0-9.\-]{1,15})(?:\s*'?\d{2,4})?\)\s*$/);
    if (!match) return null;
    const acronym = match[1];
    return acronym === acronym.toUpperCase() ? acronym : null;
}
