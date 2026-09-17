import { computeDblpPublicationRank, computeHalPublicationRank, confSourceFrom, journalSourceFrom } from './authorStream.js';
import { mapWithConcurrency } from './concurrency.js';
import { getSharedOverridesMap } from './matchOverrides.js';
import { resolveOverride, portalFromRank, parseOverridesJSON } from '../../front/src/matchOverrides.js';
import { resolveDisplayValue, axesForReference, customProfileIdForPortal } from '../../front/src/customRankings.js';

// Public-API-only: applies the from/to/categories/ranks/sort/export
// presentation contract documented in openapi.js's recordPresentationParameters
// to a raw dblp/HAL records array, and attaches a computed rank to every
// rankable record -- neither of which the plain records the frontend's own
// GET compat routes and SSE streaming (authorStream.js) return, since the
// frontend applies its own equivalent client-side (front/src/filterPublications.js,
// rankOrder.js, exportPublications.js) as the SSE stream comes in. This is a
// deliberate, from-scratch port of that same logic for the synchronous public
// API, not a shared module -- front and api are separate packages with no
// shared build, so the two stay independently testable at the cost of two
// small, stable, pure implementations of the same filtering/sorting rules.
// A behavior change to one is NOT guaranteed to be mirrored in the other --
// see filterPublications.js/rankOrder.js/exportPublications.js if either
// side's rules ever need to change.

// A computed rank is only ever attached to these types -- see
// authorStream.js's own rankable filters (isRankable in controllerDblpAuthor/
// rankHalPublications), which this mirrors exactly so a record either has a
// `.rank` here or it never would have gotten one via the SSE path either.
const DBLP_RANKABLE_TYPES = new Set(['inproceedings', 'article']);
const HAL_RANKABLE_TYPES = new Set(['COMM', 'ART']);

// Mirrors front/src/hal.js's halCategoriesRaw -- cssClass column only,
// that's the shared 6-value vocabulary (see openapi.js's recordPresentationParameters
// `categories` enum) `categories`/filtering match against; name/color/letter
// there are display-only, not needed for a JSON API response.
const HAL_CATEGORY_CSS_CLASS = {
    ART: 'article', COMM: 'inproceedings', COUV: 'incollection', OUV: 'book',
    THESE: 'book', HDR: 'book', REPORT: 'informal', POSTER: 'informal',
    PATENT: 'informal', PROCEEDINGS: 'proceedings', LECTURE: 'informal', UNDEFINED: 'informal',
};

// A handful of rank computations in parallel -- same "shared HAL/CORE/SJR
// rate limiter, don't hammer it" reasoning as crosscheckStructure.js/
// crosscheckTeam.js's own MEMBER_CONCURRENCY, sized instead to
// sjrPortal.js's own YEAR_CACHE_MAX_SIZE/ranking_limiter precedent (8) since
// this isn't per-member HAL calls but per-publication rank lookups, mostly
// cache hits after the first request for a given venue/year.
const RANK_CONCURRENCY = 8;

async function attachRank(pub, source, options) {
    const rankable = source === 'dblp' ? DBLP_RANKABLE_TYPES.has(pub.type) : HAL_RANKABLE_TYPES.has(pub.type);
    if (!rankable) return pub;
    const { rank } = source === 'dblp'
        ? await computeDblpPublicationRank(pub, options)
        : await computeHalPublicationRank(pub, options);
    return { ...pub, rank };
}

export async function attachRanks(records, source, { confSource, journalSource }) {
    return mapWithConcurrency(records, RANK_CONCURRENCY, pub => attachRank(pub, source, { confSource, journalSource }));
}

// customRankings request parameter: {conference?, journal?}, each a whole
// custom-ranking profile object (front/src/customRankings.js's own shape --
// see profileToJSON/allProfilesToJSON) to actively apply on that axis. An
// explicit per-axis key, not one/several profiles with the axis inferred
// from their own `reference` (axesForReference) -- that inference is
// genuinely ambiguous for a 'ccf'-referenced profile, which covers *both*
// axes (axesForReference('ccf') === ['conference','journal']): supplying
// one would silently force both axes into it, with no way to say "CCF for
// journals only, leave conferences on the automatic match" -- exactly the
// independent-per-axis choice front/src/rankingSource.js's own
// conferenceSource/journalSource already model (two separate localStorage
// keys, never inferred from each other). This mirrors that shape directly.
export function parseCustomRankingsAxes(text) {
    const parsed = JSON.parse(text);
    const axes = { conference: null, journal: null };
    for (const axis of ['conference', 'journal']) {
        const profile = parsed?.[axis];
        if (!profile) continue;
        if (!profile.id || !profile.reference) {
            throw new Error(`customRankings.${axis} must be a profile object with at least id and reference`);
        }
        if (!axesForReference(profile.reference).includes(axis)) {
            throw new Error(`customRankings.${axis}: a profile referencing '${profile.reference}' cannot apply to the ${axis} axis`);
        }
        axes[axis] = { entries: {}, ...profile };
    }
    return axes;
}

// Attaches rank.effectiveValue (the exact value RankBadge.js would show,
// see resolveDisplayValue's own comment) to every already-ranked record,
// per the matchOverrides/customRankings/useCommunityCorrections request
// parameters. rank.value itself is never touched -- it stays the raw
// automatic match, same as authorStream.js's SSE path always returned.
// `fetchSharedMap` is injected (defaulting to the real Mongo-backed
// getSharedOverridesMap) so this stays testable without a database, same
// "pure core, injected I/O" shape as the rest of this codebase.
export async function applyCorrections(records, source, { matchOverridesText, customRankingsText, useCommunityCorrections = true } = {}, { fetchSharedMap = getSharedOverridesMap } = {}) {
    const overrides = matchOverridesText ? parseOverridesJSON(matchOverridesText) : {};
    const axes = customRankingsText ? parseCustomRankingsAxes(customRankingsText) : { conference: null, journal: null };
    const activeCustomProfileIds = { conference: axes.conference?.id ?? null, journal: axes.journal?.id ?? null };
    const profiles = {};
    if (axes.conference) profiles[axes.conference.id] = axes.conference;
    if (axes.journal) profiles[axes.journal.id] = axes.journal;

    // One shared-map fetch per portal actually present in this batch, not
    // per record -- mirrors useSharedOverridesMaps.js's own "once per page
    // load, not once per badge" reasoning.
    const portalsPresent = new Set(records.map(pub => pub.rank && portalFromRank(pub.rank)).filter(Boolean));
    const sharedMaps = {};
    if (useCommunityCorrections) {
        for (const portal of portalsPresent) {
            sharedMaps[portal] = await fetchSharedMap(portal);
        }
    }

    return records.map(pub => {
        if (!pub.rank) return pub;
        const portal = portalFromRank(pub.rank);
        const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
        const override = resolveOverride(overrides, portal, pub.rank);
        const effectiveValue = resolveDisplayValue(overrides, profiles, pub.rank, {
            portal, sharedMap: sharedMaps[portal], customProfileId, override, year: yearOf(pub, source),
        });
        return { ...pub, rank: { ...pub.rank, effectiveValue } };
    });
}

function yearOf(pub, source) {
    const year = source === 'dblp' ? pub.dblp?.year : pub.year;
    return year != null ? parseInt(year, 10) : null;
}

function categoryOf(pub, source) {
    return source === 'dblp' ? pub.type : (HAL_CATEGORY_CSS_CLASS[pub.type] || 'informal');
}

// Query-param parsing for recordPresentationParameters -- style:'form',
// explode:false in openapi.js means a single comma-separated query value
// (e.g. ?categories=article,inproceedings), not repeated ?categories=...
// params.
function parseCsvParam(value) {
    if (!value) return null;
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

// Adapted from front/src/filterPublications.js's identical-purpose filter:
// that one checks membership against a UI checkbox map built from an
// always-fully-enumerated category/rank set, this checks membership against
// an explicit include-list (absent/empty query param = no filtering on that
// axis) -- the natural shape for a query parameter versus a checkbox map,
// same filtering semantics (year in range, category/rank in the allowed
// set) either way.
export function filterRecords(records, source, { from, to, categories, ranks }) {
    return records
        .filter(pub => {
            const year = yearOf(pub, source);
            return year == null || ((from == null || year >= from) && (to == null || year <= to));
        })
        .filter(pub => !categories || categories.includes(categoryOf(pub, source)))
        .filter(pub => !ranks || !pub.rank || ranks.includes(pub.rank.effectiveValue ?? pub.rank.value));
}

// Ported from front/src/rankOrder.js's rankTier/orderPublicationsForDisplay
// -- pure, dependency-free, so kept verbatim rather than adapted. Flattened
// to just the records in display order (no group-heading markers): those
// are a UI presentation concern (Publications.js/HalPublications.js's own
// section headers), meaningless in a JSON/CSV/Markdown API response where
// year/rank are already their own fields.
const TIER_BY_VALUE = { 'A*': 1, 'Q1': 1, 'A': 2, 'Q2': 2, 'B': 3, 'Q3': 3, 'C': 4, 'Q4': 4, 'Misc': 5, 'Unranked': 6 };
function rankTier(rank) {
    return TIER_BY_VALUE[rank?.effectiveValue ?? rank?.value] || 6;
}

export function sortRecords(records, source, sortMode) {
    const sorted = [...records].sort((a, b) => (yearOf(b, source) || 0) - (yearOf(a, source) || 0));
    if (sortMode === 'rank-date') {
        return sorted.sort((a, b) => rankTier(a.rank) - rankTier(b.rank)); // stable sort keeps year-desc within a tier
    }
    if (sortMode === 'date-rank') {
        const byYear = new Map();
        for (const pub of sorted) {
            const year = yearOf(pub, source);
            if (!byYear.has(year)) byYear.set(year, []);
            byYear.get(year).push(pub);
        }
        const out = [];
        for (const group of byYear.values()) {
            out.push(...group.sort((a, b) => rankTier(a.rank) - rankTier(b.rank)));
        }
        return out;
    }
    return sorted;
}

// Reads recordPresentationParameters off req.query, in the shape
// filterRecords/sortRecords/renderExport above expect.
export function presentationOptionsFrom(req) {
    const from = req.query.from != null ? parseInt(req.query.from, 10) : null;
    const to = req.query.to != null ? parseInt(req.query.to, 10) : null;
    return {
        from: Number.isFinite(from) ? from : null,
        to: Number.isFinite(to) ? to : null,
        categories: parseCsvParam(req.query.categories),
        ranks: parseCsvParam(req.query.ranks),
        sort: ['date', 'date-rank', 'rank-date'].includes(req.query.sort) ? req.query.sort : 'date',
        export: ['md', 'csv', 'json'].includes(req.query.export) ? req.query.export : null,
        // Default true, same as front/src/matchOverrides.js's own
        // getUseCommunityOverrides -- an opt-out, not opt-in, or the
        // feature would only ever reach whoever explicitly asks for it.
        useCommunityCorrections: req.query.useCommunityCorrections !== 'false',
        matchOverridesText: typeof req.query.matchOverrides === 'string' ? req.query.matchOverrides : null,
        customRankingsText: typeof req.query.customRankings === 'string' ? req.query.customRankings : null,
    };
}

// ****************************************************************************************************
// ****************************************************************************************************
// Export rendering -- ported from front/src/exportPublications.js's
// dblpFields/halFields/renderMarkdownBody/renderCsvBody/jsonPublications
// (the actual field extraction and Markdown/CSV/JSON shaping), minus
// downloadTextFile's Blob/anchor dance (browser-only, meaningless
// server-side: the caller just gets the rendered body back with the right
// Content-Type instead of triggering a save).

function mdEscape(text) {
    return String(text ?? '').replace(/([*_[\]])/g, '\\$1');
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dblpTitleText(o) {
    if (o && typeof o === 'object') return `${o.i || ''}${o._ || ''}`;
    return o || '';
}

function findDoiUrl(ee) {
    const urls = Array.isArray(ee) ? ee : (ee ? [ee] : []);
    return urls.find(u => /^https?:\/\/doi\.org\//i.test(u)) || null;
}

function trimLastDigits(str) {
    return str.replace(/\s*\d*$/, '').trim();
}

function fieldsOf(pub, source) {
    // effectiveValue when corrections were applied (see applyCorrections),
    // else the raw automatic value -- same priority the front's own export
    // (exportPublications.js's rankLabel: item.rank?.value) would need
    // updating to if it ever grows the same correction-aware export this
    // one already has.
    const rankValue = pub.rank?.effectiveValue ?? pub.rank?.value ?? 'Unranked';
    if (source === 'dblp') {
        return {
            year: pub.dblp.year, rank: rankValue,
            authors: (pub.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed',
            title: dblpTitleText(pub.dblp.title), venue: pub.venue || '', type: pub.type,
            doiUrl: findDoiUrl(pub.dblp.ee),
        };
    }
    return {
        year: pub.year, rank: rankValue,
        authors: (pub.authors || []).map(a => a.name).join(', ') || 'No authors listed',
        title: pub.title, venue: pub.venue || '', type: pub.type,
        doiUrl: pub.doi ? `https://doi.org/${pub.doi}` : null,
    };
}

const CSV_HEADER = ['year', 'rank', 'authors', 'title', 'venue', 'type', 'doi'];

// records: already filtered/ranked, in final sort order (see
// filterRecords/sortRecords above) -- this only renders them, it doesn't
// re-sort.
export function renderExport(format, records, source, title) {
    if (format === 'csv') {
        const rows = [CSV_HEADER, ...records.map(pub => {
            const f = fieldsOf(pub, source);
            return [f.year, f.rank, f.authors, f.title, f.venue, f.type, f.doiUrl || ''];
        })];
        return { contentType: 'text/csv; charset=utf-8', body: rows.map(row => row.map(csvEscape).join(',')).join('\r\n') };
    }
    if (format === 'json') {
        const publications = records.map(pub => {
            const f = fieldsOf(pub, source);
            return { year: f.year, rank: f.rank, authors: f.authors, title: f.title, venue: f.venue, type: f.type, doi: f.doiUrl };
        });
        return { contentType: 'application/json; charset=utf-8', body: JSON.stringify({ title, publications }, null, 2) };
    }
    // 'md'
    let body = `# ${title}\n`;
    for (const pub of records) {
        const f = fieldsOf(pub, source);
        body += `- **[${f.rank}]** ${mdEscape(f.authors)}. **${mdEscape(f.title)}.** ${mdEscape(f.venue)}${f.doiUrl ? ` [DOI](${f.doiUrl})` : ''}\n`;
    }
    return { contentType: 'text/markdown; charset=utf-8', body };
}

// One-stop orchestration for the 4 public "records" controllers
// (dblp.controllerAuthor's POST branch, hal.controllerAuthor,
// hal.controllerStructurePublications, teamRecords.controllerTeamRecords):
// rank every record, apply from/to/categories/ranks/sort, then either send
// the resulting array as JSON (the `records` field of whatever envelope the
// caller passes as `wrap`) or, if `export` was requested, send the rendered
// export body instead with the matching Content-Type -- a caller-supplied
// `wrap(records)` builds the normal JSON envelope (e.g. `{ author, records }`
// for dblp, a bare array for HAL) since that shape differs per endpoint.
export async function respondWithRecords(req, res, rawRecords, source, exportTitle, wrap = records => records) {
    const confSource = confSourceFrom(req);
    const journalSource = journalSourceFrom(req);
    const options = presentationOptionsFrom(req);

    const ranked = await attachRanks(rawRecords, source, { confSource, journalSource });
    const corrected = await applyCorrections(ranked, source, options);
    const filtered = filterRecords(corrected, source, options);
    const sorted = sortRecords(filtered, source, options.sort);

    if (options.export) {
        const { contentType, body } = renderExport(options.export, sorted, source, exportTitle);
        res.set('Content-Type', contentType).send(body);
        return;
    }
    res.json(wrap(sorted));
}
