import { getSharedOverridesMap } from './matchOverrides.js';
import { resolveOverride, portalFromRank, parseOverridesJSON } from '../../front/src/matchOverrides.js';
import { resolveDisplayValue } from '../../front/src/customRankings.js';
import { mdEscape, csvEscape, dblpTitleText, findDoiUrl, trimLastDigits, parseCustomRankingsAxes } from './recordPresentation.js';
import { customProfileIdForPortal } from '../../front/src/customRankings.js';

// Public-API-only, crosscheck/{author,structure,team}'s own sibling of
// recordPresentation.js -- same from/matchOverrides/customRankings/
// useCommunityCorrections/export contract, but over a structurally
// different shape (a `result` has a `status`, its own `publication.rank`,
// AND zero-or-more `matches[].halPub.rank` -- not a flat ranked-record
// array) so filtering/correcting/exporting it needs its own pass rather
// than reusing recordPresentation.js's own functions directly. Only
// `from`/`to`, `export`, `matchOverrides`, `customRankings` and
// `useCommunityCorrections` are implemented here -- `categories`/`ranks`/
// `sort` are deliberately NOT: no crosscheck page in the web app has a
// category/rank filter or a sort control (verified against CrossCheck.js/
// CrossCheckStructure.js/CrossCheckTeam.js directly), unlike the record
// endpoints' own categories/ranks/sort, which port real FilterButton/
// rank-filter/SortButton behavior -- inventing them here would give the
// API a richer contract than the product it's meant to mirror.

function yearOfResult(result) {
    const year = result.publication?.dblp?.year;
    return year != null ? parseInt(year, 10) : null;
}

// from/to: see recordPresentation.js's identical filterRecords -- absent/
// invalid means "don't filter", same as every crosscheck page's own
// hasYearRange check (CrossCheck.js and, since this feature, CrossCheckStructure.js/
// CrossCheckTeam.js too).
export function filterResultsByYear(results, { from, to }) {
    if (from == null && to == null) return results;
    return results.filter(result => {
        const year = yearOfResult(result);
        return year == null || ((from == null || year >= from) && (to == null || year <= to));
    });
}

// Attaches rank.effectiveValue to a result's own publication.rank AND every
// HAL candidate's own rank in result.matches -- RankBadge.js renders both
// (PublicationRow for the DBLP side, HalPublicationRow for each candidate,
// see CrossCheckSection.js), so a correction has to reach both to match
// what the web app actually shows. Same injected-fetchSharedMap shape as
// recordPresentation.js's own applyCorrections, for the same testability
// reason.
export async function applyCorrectionsToResults(results, { matchOverridesText, customRankingsText, useCommunityCorrections = true } = {}, { fetchSharedMap = getSharedOverridesMap } = {}) {
    const overrides = matchOverridesText ? parseOverridesJSON(matchOverridesText) : {};
    const axes = customRankingsText ? parseCustomRankingsAxes(customRankingsText) : { conference: null, journal: null };
    const activeCustomProfileIds = { conference: axes.conference?.id ?? null, journal: axes.journal?.id ?? null };
    const profiles = {};
    if (axes.conference) profiles[axes.conference.id] = axes.conference;
    if (axes.journal) profiles[axes.journal.id] = axes.journal;

    const ranks = [];
    for (const result of results) {
        if (result.publication?.rank) ranks.push(result.publication.rank);
        for (const match of result.matches || []) {
            if (match.halPub?.rank) ranks.push(match.halPub.rank);
        }
    }
    const portalsPresent = new Set(ranks.map(portalFromRank));
    const sharedMaps = {};
    if (useCommunityCorrections) {
        for (const portal of portalsPresent) {
            sharedMaps[portal] = await fetchSharedMap(portal);
        }
    }

    const withEffectiveValue = (rank, year) => {
        if (!rank) return rank;
        const portal = portalFromRank(rank);
        const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
        const override = resolveOverride(overrides, portal, rank);
        const effectiveValue = resolveDisplayValue(overrides, profiles, rank, {
            portal, sharedMap: sharedMaps[portal], customProfileId, override, year,
        });
        return { ...rank, effectiveValue };
    };

    return results.map(result => {
        const year = yearOfResult(result);
        return {
            ...result,
            publication: result.publication?.rank ? { ...result.publication, rank: withEffectiveValue(result.publication.rank, year) } : result.publication,
            matches: (result.matches || []).map(m => (m.halPub?.rank ? { ...m, halPub: { ...m.halPub, rank: withEffectiveValue(m.halPub.rank, year) } } : m)),
        };
    });
}

// ****************************************************************************************************
// ****************************************************************************************************
// Export rendering -- ported from front/src/exportCrossCheck.js (Markdown/
// JSON) and each CrossCheck*.js's own local exportCsv (CSV, never
// centralized there -- see this module's own header comment for why this
// stays a from-scratch port rather than a direct import, same reasoning as
// recordPresentation.js's own export section).

function rankLabel(rank) {
    return rank?.effectiveValue ?? rank?.value ?? 'Unranked';
}

function dblpPublicationLine(publication) {
    const rank = rankLabel(publication.rank);
    const authors = (publication.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed';
    const title = mdEscape(dblpTitleText(publication.dblp.title));
    const venue = mdEscape(publication.venue || '');
    const doiUrl = findDoiUrl(publication.dblp.ee);
    return `**[${rank}]** ${authors}. **${title}.** ${venue}${doiUrl ? ` [DOI](${doiUrl})` : ''}`;
}

function halCandidateLine(halPub, distance) {
    const authors = (halPub.authors || []).map(a => a.name).join(', ') || 'No authors listed';
    const title = mdEscape(halPub.title);
    const venue = mdEscape(halPub.venue || '');
    const doiUrl = halPub.doi ? `https://doi.org/${halPub.doi}` : null;
    return `HAL ${halPub.year || '—'}: ${authors}. **${title}.** ${venue}${doiUrl ? ` [DOI](${doiUrl})` : ''}${distance != null ? ` _(distance ${distance})_` : ''}`;
}

function renderResultsSections(results) {
    const missing = results.filter(r => r.status === 'missing');
    const toReview = results.filter(r => r.status === 'to-review');
    let out = `\n### Missing from HAL (${missing.length})\n\n`;
    out += missing.length ? missing.map(r => `- ${dblpPublicationLine(r.publication)}\n`).join('') : '_None_\n';
    out += `\n### To review (${toReview.length})\n\n`;
    out += toReview.length
        ? toReview.map(r => {
            let block = `- ${dblpPublicationLine(r.publication)}\n`;
            block += r.matches.map(m => `  - ${halCandidateLine(m.halPub, m.distance)}\n`).join('');
            return block;
        }).join('')
        : '_None_\n';
    return out;
}

function resultToJson(result) {
    const publication = result.publication;
    return {
        status: result.status,
        rank: rankLabel(publication.rank),
        year: publication.dblp.year,
        authors: (publication.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed',
        title: dblpTitleText(publication.dblp.title),
        venue: publication.venue || '',
        type: publication.type,
        doi: findDoiUrl(publication.dblp.ee),
        dblpKey: publication.dblp.key,
        matches: (result.matches || []).map(m => ({
            docid: m.halPub.docid,
            year: m.halPub.year,
            authors: (m.halPub.authors || []).map(a => a.name).join(', ') || 'No authors listed',
            title: m.halPub.title,
            venue: m.halPub.venue || '',
            doi: m.halPub.doi ? `https://doi.org/${m.halPub.doi}` : null,
            distance: m.distance ?? null,
        })),
    };
}

function resultsToJsonSections(results) {
    return {
        missing: results.filter(r => r.status === 'missing').map(resultToJson),
        toReview: results.filter(r => r.status === 'to-review').map(resultToJson),
    };
}

const CSV_HEADER = ['status', 'title', 'year', 'venue', 'type', 'dblpKey', 'halCandidates'];

function resultToCsvRow(result) {
    const publication = result.publication;
    return [
        result.status, publication.dblp.title, publication.dblp.year, publication.venue, publication.type, publication.dblp.key,
        (result.matches || []).map(m => `${m.halPub.title}${m.distance != null ? ` (d=${m.distance})` : ''}`).join(' | '),
    ];
}

function resultsToCsv(results) {
    const rows = [CSV_HEADER, ...results.map(resultToCsvRow)];
    return rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
}

// results: already year-filtered and correction-applied (see
// filterResultsByYear/applyCorrectionsToResults above) -- this only
// renders them.
export function renderCrossCheckExport(format, results, title) {
    if (format === 'csv') return { contentType: 'text/csv; charset=utf-8', body: resultsToCsv(results) };
    if (format === 'json') return { contentType: 'application/json; charset=utf-8', body: JSON.stringify({ title, ...resultsToJsonSections(results) }, null, 2) };
    return { contentType: 'text/markdown; charset=utf-8', body: `# ${title}\n${renderResultsSections(results)}` };
}

// members: [{..., results}], already filtered/corrected per member.
export function renderCrossCheckExportByMember(format, members, title, memberLabel) {
    if (format === 'csv') {
        const rows = [['member', ...CSV_HEADER]];
        for (const member of members) {
            for (const result of member.results) rows.push([memberLabel(member), ...resultToCsvRow(result)]);
        }
        return { contentType: 'text/csv; charset=utf-8', body: rows.map(row => row.map(csvEscape).join(',')).join('\r\n') };
    }
    if (format === 'json') {
        const body = JSON.stringify({ title, members: members.map(member => ({ member: memberLabel(member), ...resultsToJsonSections(member.results) })) }, null, 2);
        return { contentType: 'application/json; charset=utf-8', body };
    }
    let body = `# ${title}\n`;
    for (const member of members) {
        body += `\n## ${memberLabel(member)}\n`;
        body += renderResultsSections(member.results);
    }
    return { contentType: 'text/markdown; charset=utf-8', body };
}

// Reads from/to/export/useCommunityCorrections/matchOverrides/customRankings
// off req.body first, falling back to req.query -- unlike
// recordPresentation.js's own presentationOptionsFrom (query-only, matching
// recordPresentationParameters' own `in: 'query'`), openapi.js documents
// crossCheckOptions as request-BODY properties (crosscheck/author's own pid/
// halId sit right alongside them in the same JSON object), the same
// body-first-fallback-to-query shape this file's controllers already use
// for identityLinks (see e.g. crosscheck.js's own
// `req.body?.identityLinks ?? req.query.identityLinks`). categories/ranks/
// sort are omitted -- see this module's own header comment.
export function crossCheckPresentationOptionsFrom(req) {
    const rawFrom = req.body?.from ?? req.query.from;
    const rawTo = req.body?.to ?? req.query.to;
    const from = rawFrom != null ? parseInt(rawFrom, 10) : null;
    const to = rawTo != null ? parseInt(rawTo, 10) : null;
    const exportFormat = req.body?.export ?? req.query.export;
    const useCommunityCorrections = req.body?.useCommunityCorrections ?? req.query.useCommunityCorrections;
    const matchOverrides = req.body?.matchOverrides ?? req.query.matchOverrides;
    const customRankings = req.body?.customRankings ?? req.query.customRankings;
    return {
        from: Number.isFinite(from) ? from : null,
        to: Number.isFinite(to) ? to : null,
        export: ['md', 'csv', 'json'].includes(exportFormat) ? exportFormat : null,
        useCommunityCorrections: useCommunityCorrections !== false && useCommunityCorrections !== 'false',
        matchOverridesText: typeof matchOverrides === 'string' ? matchOverrides : null,
        customRankingsText: typeof customRankings === 'string' ? customRankings : null,
    };
}
