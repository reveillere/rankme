import * as admin from './admin.js';
import * as cache from './cache.js';
import * as identityResolution from './identityResolution.js';
import * as crosscheck from './crosscheck.js';
import { confSourceFrom, journalSourceFrom } from './authorStream.js';
import { parseIdentityLinks, IdentityLinksConflictError } from './identityLinksInput.js';
import { mapWithConcurrency } from './concurrency.js';
import { crossCheckPresentationOptionsFrom, filterResultsByYear, applyCorrectionsToResults, renderCrossCheckExportByMember } from './crosscheckPresentation.js';

// ****************************************************************************************************
// ****************************************************************************************************
// Structure-scope, DBLP -> HAL crosscheck: runs identityResolution.js's own
// name/orcid pipeline over a whole HAL lab, then crosscheck.js's own
// one-pair matching for every member it managed to resolve a pid for.
// Deliberately a thin assembly layer -- all the actual work (name/orcid
// arbitration, title matching, ranking, override application) already lives
// in and is unit-tested by those two modules; this only fans a member list
// out to getCrossCheckReport and stitches the per-member reports back
// together for the UI.

// A handful in parallel, not Promise.all with no cap: LaBRI alone (the lab
// used to measure this feature) has ~200 idHal members, and each one costs
// getCrossCheckReport a hal.getAuthorPublications call -- firing all of them
// at once would slam the shared HAL rate limiter (throttler.js) that every
// other author/structure page also depends on. 4 mirrors crosscheck.js's own
// "a handful, not hundreds" reasoning; there is no ranking_limiter-style
// SSE/priority machinery to reuse here (this stays a one-shot JSON response,
// same as getCrossCheckReport itself), so a small local pool is enough.
const MEMBER_CONCURRENCY = 4;

const CACHE_TTL_S = 60 * 60; // 1h -- same rationale as crosscheck.js/identityResolution.js's own
                              // report caches. Each member's own sub-report is already cached
                              // individually by getCrossCheckReport, so this mostly saves the N
                              // Redis round-trips and the assembly loop itself, not real work.

// ****************************************************************************************************
// ****************************************************************************************************
// Pure assembly core, injected with its I/O so it can be unit-tested without
// a real Mongo/HAL/Redis behind it -- same shape as identityResolution.js's
// own createIdentityResolver. Wired to the real dependencies below.

export function createStructureCrossChecker({ getIdentityResolutionReport, getCrossCheckReport, getDblpStatus, getPersonLinksVersion, getCache, setCache }) {
    return async function resolveStructureCrossCheck(structId, { confSource, journalSource, identityLinks = null }) {
        const dblpStatus = await getDblpStatus();
        // Keyed the same way crosscheck.js/identityResolution.js key their own
        // reports -- the dump version and both ranking sources, since either
        // changes what "missing"/"to-review" and each publication's rank mean.
        // Snapshot before computation so an in-flight report cannot poison
        // the cache for a later identity edit.
        const linksVersion = await getPersonLinksVersion();
        const key = `crosscheck:structure:local-v1:${structId}:${dblpStatus.version}:${confSource}:${journalSource}:${linksVersion}`;

        // Supplied links are request-specific and must never leak into the
        // shared structure cache. Note parseIdentityLinks returns a truthy
        // {byIdHal, byPid} object even for an empty links array (the front
        // end always sends an `identityLinks` field, [] when the user has
        // none) -- so it's the presence of an actual link, not just a non-null
        // object, that has to bypass the cache, or it never gets used.
        const hasSuppliedLinks = identityLinks && identityLinks.byIdHal.size > 0;
        if (!hasSuppliedLinks) {
            const cached = await getCache(key);
            if (cached !== null) return cached;
        }

        const identityReport = await getIdentityResolutionReport(structId);
        // A caller-provided link is an explicit decision for this request;
        // it takes precedence over an inferred/stored link for that member.
        const effectiveIdentityReport = identityLinks ? identityReport.map(member => {
            const pid = identityLinks.byIdHal.get(member.idHal);
            return pid ? { ...member, resolved: { pid, source: 'provided' }, confidence: 'confirmed' } : member;
        }) : identityReport;
        // `resolved?.pid` is the only thing that matters here, regardless of
        // the confidence level that produced it ('confirmed' via a saved
        // personLink/orcid match, or 'probable'/'to-review' promoted to a
        // link by a maintainer via controllerRecordLink) -- once a pid is on
        // file for an idHal, crosscheck.js has everything it needs.
        const resolvedMembers = effectiveIdentityReport.filter(m => m.resolved?.pid);
        const unresolvedMembers = effectiveIdentityReport.filter(m => !m.resolved?.pid);

        const memberResults = await mapWithConcurrency(resolvedMembers, MEMBER_CONCURRENCY, async member => {
            const report = await getCrossCheckReport(member.resolved.pid, member.idHal, { confSource, journalSource });
            return { member, report };
        });

        let dblpStatusOut = null;
        let halCacheNote = null;
        let totalConfirmedCount = 0;
        const members = [];
        for (const { member, report } of memberResults) {
            if (report === null) {
                // The pid a personLink/identity-resolution pointed to is no
                // longer known to the current dblp dump (a stale manual link,
                // or an import that dropped that homepage) -- getCrossCheckReport's
                // own 404 case. Can't cross-check this member at all, but
                // this is one lab member out of possibly hundreds, not the
                // whole request -- logged and skipped, same spirit as
                // computeDblpPublicationRank's own per-item try/catch in
                // crosscheck.js rather than failing the entire report.
                console.log('[crosscheckStructure] Skipping member with unknown dblp pid', member.idHal, member.resolved.pid);
                continue;
            }
            if (dblpStatusOut === null) {
                dblpStatusOut = report.dblpStatus;
                halCacheNote = report.halCacheNote;
            }
            // Attached to every result (not just its `publication`) so the
            // UI can group/label a combined list by member without having to
            // carry a separate parallel array around -- see CrossCheckStructure.js.
            const memberInfo = { idHal: member.idHal, name: member.name, pid: member.resolved.pid };
            const results = report.results.map(result => ({ ...result, member: memberInfo }));
            const confirmedCount = results.filter(r => r.status === 'confirmed').length;
            totalConfirmedCount += confirmedCount;
            members.push({ idHal: member.idHal, name: member.name, pid: member.resolved.pid, confidence: member.confidence, results, confirmedCount });
        }

        // Every resolved member failed to cross-check (report === null for
        // all of them) -- falls back to the dump's own status directly, same
        // shape getCrossCheckReport itself would have produced, so the UI's
        // freshness banner always has something to show.
        if (dblpStatusOut === null) {
            dblpStatusOut = { version: dblpStatus.version, importedAt: dblpStatus.importedAt };
            halCacheNote = 'HAL data may be up to 24h stale';
        }

        const report = {
            dblpStatus: dblpStatusOut,
            halCacheNote,
            members,
            unresolvedMembers: unresolvedMembers.map(m => ({ idHal: m.idHal, name: m.name, confidence: m.confidence, candidates: m.candidates })),
            confirmedCount: totalConfirmedCount,
        };
        if (!hasSuppliedLinks) await setCache(key, report, CACHE_TTL_S);
        return report;
    };
}

// ****************************************************************************************************
// ****************************************************************************************************
// Real I/O wired into createStructureCrossChecker above.

export const getStructureCrossCheckReport = createStructureCrossChecker({
    getIdentityResolutionReport: identityResolution.getIdentityResolutionReport,
    getCrossCheckReport: crosscheck.getCrossCheckReport,
    getDblpStatus: admin.getDblpStatus,
    getPersonLinksVersion: identityResolution.getPersonLinksVersion,
    getCache: cache.get,
    setCache: cache.set,
});

export async function controllerCrossCheckStructure(req, res) {
    const structId = req.params.structId || req.body?.structId;
    const confSource = confSourceFrom(req);
    const journalSource = journalSourceFrom(req);
    try {
        const identityLinks = parseIdentityLinks(req.body?.identityLinks ?? req.query.identityLinks);
        const report = await getStructureCrossCheckReport(structId, { confSource, journalSource, identityLinks });
        // POST-only, same as crosscheck.js's own controllerCrossCheck: the
        // front end now POSTs to /internal/crosscheck/structure, and that
        // route already does this filtering/correction work client-side.
        if (req.method === 'POST' && req.route.path !== '/internal/crosscheck/structure') {
            const options = crossCheckPresentationOptionsFrom(req);
            const members = [];
            let totalConfirmedCount = 0;
            for (const member of report.members) {
                const filtered = filterResultsByYear(member.results, options);
                const results = await applyCorrectionsToResults(filtered, options);
                const confirmedCount = results.filter(r => r.status === 'confirmed').length;
                totalConfirmedCount += confirmedCount;
                members.push({ ...member, results, confirmedCount });
            }
            if (options.export) {
                const title = `DBLP → HAL cross-check for ${structId}`;
                const memberLabel = member => `${member.name || member.idHal} (idHal: ${member.idHal}, pid: ${member.pid})`;
                const { contentType, body } = renderCrossCheckExportByMember(options.export, members, title, memberLabel);
                res.set('Content-Type', contentType).send(body);
                return;
            }
            res.json({ ...report, members, confirmedCount: totalConfirmedCount });
            return;
        }
        res.json(report);
    } catch (error) {
        console.log('Error during structure cross-check computation', error);
        res.status(error instanceof IdentityLinksConflictError ? 409 : 400).json({ error: error.message });
    }
}
