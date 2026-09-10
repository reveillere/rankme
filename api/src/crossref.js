import * as cache from './cache.js';
import { normalizeTitle } from './levenshtein.js';

import fetch from './throttler.js';

const BASE = 'https://api.crossref.org';

// dblp's own <ee> element(s) -- usually a DOI link (https://doi.org/...),
// but a record can have several (e.g. also an arXiv mirror), and a
// repeated XML field comes back as an array rather than a lone string (see
// admin.js's wireRecordParser) -- so this accepts either shape and returns
// the bare DOI (Crossref's own API wants it without the URL prefix, same
// as HAL's doiId_s already is) from the first entry that looks like one.
export function extractDoi(ee) {
    const urls = Array.isArray(ee) ? ee : (ee ? [ee] : []);
    for (const url of urls) {
        const match = /^https?:\/\/doi\.org\/(.+)$/i.exec(url);
        if (match) return match[1];
    }
    return null;
}

const LONG_TTL_S = 60 * 60 * 24 * 365; // 1 year: published DOI metadata rarely changes, and Crossref genuinely having no useful venue info for a DOI is a stable fact too
const FAILURE_TTL_S = 60 * 60 * 4; // 4 hours: a 429/timeout/network error is transient -- caching that for a year would bake in a rate-limit hit or a blip long after Crossref would have happily answered again

// Crossref's own event/container metadata is far cleaner than HAL's
// free-text conferenceTitle_s (typed by the depositor at submission time),
// and it often carries an acronym HAL doesn't expose at all -- letting HAL
// publications use the same acronym-first CORE matching as DBLP publications
// instead of a pure fuzzy match over the whole ranking database.
// Exported so authorStream.js's batch prefetch can compute the exact same
// key for a bulk MGET without duplicating (and risking drifting from) this
// format.
export function venueKey(doi) {
    return `crossref:venue:${doi}`;
}

// prefetched, when given, is a Map already populated by a bulk MGET (see
// authorStream.js) -- prefetched.has(key) means that key was definitely
// checked in that batch, so its value (present or not) is authoritative and
// worth skipping a redundant Redis round-trip for. A key absent from
// prefetched just falls back to a normal cache.get, unchanged from before
// this parameter existed.
export async function getVenueInfo(doi, prefetched) {
    const key = venueKey(doi);

    // Wrapped in { info } rather than caching the bare value: a DOI with no
    // useful venue info at all is a legitimate, cacheable result (info:
    // null), but cache.get() returns bare `null` for a cache MISS too --
    // without the wrapper the two are indistinguishable, and every such DOI
    // (including one that failed 429 rate-limiting, see fetchVenueInfo) was
    // silently refetched from Crossref on every single call instead of ever
    // actually being cached.
    const cached = prefetched?.has(key) ? prefetched.get(key) : await cache.get(key);
    if (cached !== null && cached !== undefined) return cached.info;

    const { info, ttlS } = await fetchVenueInfo(doi);
    cache.set(key, { info }, ttlS);
    return info;
}

async function fetchVenueInfo(doi) {
    try {
        const resp = await fetch(`${BASE}/works/${encodeURIComponent(doi)}`);
        const data = await resp.json();
        const work = data?.message;
        if (!work) return { info: null, ttlS: LONG_TTL_S };

        // Springer records list the series name first, then the actual
        // proceedings/book title (e.g. ["Lecture Notes in Computer Science",
        // "Middleware 2012"]); ACM/IEEE records carry a single entry. The
        // real venue title is always the last one.
        const containerTitles = work['container-title'] || [];
        const fullName = containerTitles[containerTitles.length - 1] || work.event?.name || null;
        const acronym = extractAcronym(work, fullName);

        return { info: (fullName || acronym) ? { fullName, acronym } : null, ttlS: LONG_TTL_S };
    } catch (error) {
        console.log('[crossref] Error fetching venue info for', doi, ':', error.message);
        return { info: null, ttlS: FAILURE_TTL_S };
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

// HAL depositors sometimes spell out that a workshop was co-located with a
// bigger conference in the venue text itself (e.g. "... (IMIS 2010)
// colocated with ... (CISIS 2010)"). Past that phrase the text describes a
// DIFFERENT venue than this record's own -- the same misattribution risk as
// Crossref reusing a host event's metadata (see sameVenue below), except
// here the host's exact title sits right there as plain text, so even a
// fuzzy title match (not just acronym extraction) would happily latch onto
// it. Cut it off before any matching -- acronym or fuzzy -- happens.
const HAS_COLOCATION_CAVEAT = /\bco-?located\b/i;
const COLOCATION_SUFFIX = /\s+co-?located\s+with\b.*$/i;

// Exported for authorStream.js to apply to HAL's raw venue text before any
// matching, so a co-located host's title never enters the fuzzy match, and
// this record's own trailing/leading acronym (here, "IMIS") -- which was
// sitting right before the "colocated with" phrase -- can still be found.
export function stripColocationSuffix(text) {
    return text ? text.replace(COLOCATION_SUFFIX, '') : text;
}

// A trailing parenthesised acronym, optionally followed by a year/edition
// marker inside the same parens (e.g. "(ICDCS)", "(COMPSAC 2013)",
// "(DSN-S)"). Only trusted when it was already upper-case in the source
// text, so an incidental descriptive aside -- e.g. "(revised)" -- doesn't
// get mistaken for one. Exported for authorStream.js to run over HAL's own
// raw venue text too, which very often already carries its own acronym this
// way even without a DOI/Crossref lookup.
export function extractTrailingAcronym(text) {
    if (!text || HAS_COLOCATION_CAVEAT.test(text)) return null;
    const match = text.match(/\(([A-Za-z][A-Za-z0-9.\-]{1,15})(?:\s*'?\d{2,4})?\)\s*$/);
    if (!match) return null;
    const acronym = match[1];
    return acronym === acronym.toUpperCase() ? acronym : null;
}

// HAL's own conferenceTitle_s often puts the acronym at the *front* instead
// of a trailing "(...)" -- e.g. "ASE18 - Proceedings of the 33rd...",
// "ASE'25 - 40th...", "IC2E 2025 - IEEE...", "WWW '22: Companion...". A
// generic org name ahead of the real acronym (e.g. "IEEE S&P 2018 - 39th
// IEEE Symposium on Security and Privacy") is skipped first, and any
// non-alphanumeric characters are stripped from the result (CORE's own
// acronym for that entry is "SP", not "S&P").
const GENERIC_LEADING_ORG = /^(ACM\/IEEE|IEEE\/ACM|ACM|IEEE|IFIP|USENIX)\s+/;

export function extractLeadingAcronym(text) {
    if (!text || HAS_COLOCATION_CAVEAT.test(text)) return null;
    const rest = text.replace(GENERIC_LEADING_ORG, '');
    const match = rest.match(/^([A-Za-z][A-Za-z0-9&]{1,9}?)(\s*'?\d{2,4})?\s*[-:]\s+\S/);
    if (!match) return null;
    const acronym = match[1];
    if (acronym !== acronym.toUpperCase()) return null; // must already be upper-case in source
    const cleaned = acronym.replace(/[^A-Z0-9]/g, '');
    return cleaned.length >= 2 ? cleaned : null;
}
