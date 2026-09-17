import * as identityResolution from './identityResolution.js';
import * as crosscheck from './crosscheck.js';
import * as dblpLocal from './dblpLocal.js';
import { confSourceFrom, journalSourceFrom } from './authorStream.js';
import { parseIdentityLinks, IdentityLinksConflictError } from './identityLinksInput.js';
import { mapWithConcurrency } from './concurrency.js';
import { crossCheckPresentationOptionsFrom, filterResultsByYear, applyCorrectionsToResults, renderCrossCheckExportByMember } from './crosscheckPresentation.js';

// ****************************************************************************************************
// ****************************************************************************************************
// Team-scope crosscheck, either direction: same idea as
// crosscheckStructure.js (fan a member list out to crosscheck.js's own
// one-pair matching, stitch the per-member reports back together), except a
// rankme "team" isn't a HAL structure -- it's a client-side-only grouping
// (front/src/teamStore.js, localStorage, the server has no record of it at
// all). So there is no structId to enumerate a membership from and no
// identityResolution name/orcid batch pipeline to run: the member list
// comes straight from the request body, and each member is resolved
// individually via identityResolution.js's own single-identity lookups --
// resolveHalIdentityForPid for a dblp-sourced team (raw dblp pids, the same
// lookup the DBLP author page's "Cross-check with HAL" dialog already
// uses), resolveDblpIdentityForIdHal for a HAL-sourced one (raw idHal_s).
// There is no lab-wide name index to match against in either direction,
// same as those single-author flows.
//
// Deliberately no aggregate-level cache (unlike crosscheckStructure.js's
// own structId-keyed one): a team has no stable server-side identity to key
// on, its member list travels in the request body and can change any time
// the user edits the team client-side, and each per-member
// getCrossCheckReport call is already cached individually -- an aggregate
// cache here would only ever save the assembly loop itself, not real work.

// Mirrors crosscheckStructure.js's own MEMBER_CONCURRENCY (a handful in
// parallel, not Promise.all with no cap, to stay polite to the shared HAL
// rate limiter) -- a team is a different, unrelated caller of the same "fan
// out with a small local pool" idea, sharing only mapWithConcurrency itself
// (see concurrency.js).
const MEMBER_CONCURRENCY = 4;

// ****************************************************************************************************
// ****************************************************************************************************
// Pure assembly core, injected with its I/O so it can be unit-tested without
// a real Mongo/HAL/Redis behind it -- same shape as identityResolution.js's
// own createIdentityResolver and crosscheckStructure.js's own
// createStructureCrossChecker. Wired to the real dependencies below.

export function createTeamCrossChecker({ resolveHalIdentityForPid, resolveDblpIdentityForIdHal, getCrossCheckReport, getDblpName }) {
    return async function resolveTeamCrossCheck({ source, pids }, { confSource, journalSource, identityLinks = null }) {
        if (source !== 'dblp' && source !== 'hal') {
            throw new Error(`Team cross-check is only supported for source 'dblp' or 'hal', got '${source}'`);
        }

        const resolveMember = source === 'dblp'
            ? pid => resolveDblpSourcedMember(pid, { resolveHalIdentityForPid, getCrossCheckReport, getDblpName }, { confSource, journalSource, identityLinks })
            : idHal => resolveHalSourcedMember(idHal, { resolveDblpIdentityForIdHal, getCrossCheckReport, getDblpName }, { confSource, journalSource, identityLinks });

        const memberResults = await mapWithConcurrency(pids, MEMBER_CONCURRENCY, resolveMember);

        let dblpStatus = null;
        let halCacheNote = null;
        let totalConfirmedCount = 0;
        const members = [];
        const unresolvedMembers = [];

        for (const entry of memberResults) {
            if (entry.unresolved) {
                unresolvedMembers.push(entry.unresolved);
                continue;
            }
            const { pid, idHal, name, report } = entry;
            if (dblpStatus === null) {
                dblpStatus = report.dblpStatus;
                halCacheNote = report.halCacheNote;
            }
            // Attached to every result (not just its `publication`) so the
            // UI can group/label the combined list by member without
            // carrying a separate parallel array around -- same shape as
            // crosscheckStructure.js's own memberInfo. Always carries both
            // pid and idHal here, regardless of which side the request
            // itself supplied and which side got resolved -- see
            // resolveDblpSourcedMember/resolveHalSourcedMember below.
            const memberInfo = { pid, idHal, name };
            const results = report.results.map(result => ({ ...result, member: memberInfo }));
            const confirmedCount = results.filter(r => r.status === 'confirmed').length;
            totalConfirmedCount += confirmedCount;
            members.push({ pid, idHal, name, results, confirmedCount });
        }

        // Every member failed to cross-check (unresolved, or resolved but
        // with no report) -- there is no report left to read dblpStatus off,
        // unlike crosscheckStructure.js which still has admin.getDblpStatus()
        // handy in that case. Not fetched separately here: a team with zero
        // resolvable members has nothing else useful to show either, so a
        // null/empty dblpStatus is left for the caller to handle the same
        // way an empty members list already needs to be handled.
        return {
            dblpStatus,
            halCacheNote,
            members,
            unresolvedMembers,
            confirmedCount: totalConfirmedCount,
        };
    };
}

// Resolves one dblp-sourced team member (a raw pid) and, if a HAL identity
// is found, runs the actual crosscheck -- returns either a ready-to-fold-in
// member ({ pid, idHal, name, report }) or an { unresolved } record for the
// aggregation loop above to file straight into unresolvedMembers.
async function resolveDblpSourcedMember(pid, { resolveHalIdentityForPid, getCrossCheckReport, getDblpName }, { confSource, journalSource, identityLinks }) {
    // The dblp author's own name, independent of whether a HAL identity was
    // ever found -- identity.name only ever comes from the HAL side (a
    // fresh ORCID match's fullName_s, or nothing at all for a
    // personLinks-based resolution), so relying on it alone left both
    // resolved and unresolved members showing their bare pid twice
    // ("11/1262 (11/1262)") instead of a real name.
    const [storedIdentity, dblpName] = await Promise.all([resolveHalIdentityForPid(pid), getDblpName(pid)]);
    const identity = identityLinks?.byPid.has(pid) ? { idHal: identityLinks.byPid.get(pid), name: null } : storedIdentity;
    const name = dblpName || identity.name || null;
    if (!identity.idHal) {
        return { unresolved: { pid, name, candidateIdHal: null, candidateName: null } };
    }
    const report = await getCrossCheckReport(pid, identity.idHal, { confSource, journalSource });
    if (report === null) {
        // resolveHalIdentityForPid found an idHal, but getCrossCheckReport's
        // own dblp-pid lookup came back empty -- shouldn't happen (the pid
        // just resolved came from the same dblp dump getCrossCheckReport
        // queries), but this is one team member out of a few, not the whole
        // request, so it's reported as unresolved rather than failing the
        // entire report. Same spirit as crosscheckStructure.js's own
        // per-member skip-and-log.
        console.log('[crosscheckTeam] Skipping member with unresolved dblp pid despite an identity match', pid, identity.idHal);
        return { unresolved: { pid, name, candidateIdHal: identity.idHal, candidateName: identity.name || null } };
    }
    return { pid, idHal: identity.idHal, name, report };
}

// Mirror of resolveDblpSourcedMember above, for a HAL-sourced team member (a
// raw idHal). The known field going in is idHal instead of pid, and the
// "candidate" field on an unresolved record is candidatePid instead of
// candidateIdHal -- unresolvedMembers' shape is therefore not identical
// byte-for-byte across the two directions (each direction only ever truly
// *knows* one of the two ids up front), unlike the resolved `members` array
// above, which always carries both once a member makes it that far.
async function resolveHalSourcedMember(idHal, { resolveDblpIdentityForIdHal, getCrossCheckReport, getDblpName }, { confSource, journalSource, identityLinks }) {
    const storedIdentity = await resolveDblpIdentityForIdHal(idHal);
    const identity = identityLinks?.byIdHal.has(idHal) ? { pid: identityLinks.byIdHal.get(idHal), name: null } : storedIdentity;
    const dblpName = identity.pid ? await getDblpName(identity.pid) : null;
    // No cheap idHal-only name lookup exists on the HAL side to mirror
    // getDblpName with: hal.js's getAuthorInfo(idHal) only ever returns
    // idHal+orcid, and getAuthorPublications/parseAuthors are built to name
    // authors across a LIST of publications, not to look up one identity's
    // name in isolation. The dblp name found via the orcid match (or
    // nothing, if unresolved) is the best display name available without
    // adding a new HAL lookup for this alone; idHal itself is the
    // last-resort fallback rather than a blank name.
    const name = dblpName || identity.name || idHal;
    if (!identity.pid) {
        return { unresolved: { idHal, name, candidatePid: null, candidateName: null } };
    }
    const report = await getCrossCheckReport(identity.pid, idHal, { confSource, journalSource });
    if (report === null) {
        console.log('[crosscheckTeam] Skipping member with unresolved idHal despite an identity match', idHal, identity.pid);
        return { unresolved: { idHal, name, candidatePid: identity.pid, candidateName: identity.name || null } };
    }
    return { pid: identity.pid, idHal, name, report };
}

// ****************************************************************************************************
// ****************************************************************************************************
// Real I/O wired into createTeamCrossChecker above.

async function getDblpName(pid) {
    const names = await dblpLocal.getAuthorNames(pid);
    return names?.[0] || null;
}

export const getTeamCrossCheckReport = createTeamCrossChecker({
    resolveHalIdentityForPid: identityResolution.resolveHalIdentityForPid,
    resolveDblpIdentityForIdHal: identityResolution.resolveDblpIdentityForIdHal,
    getCrossCheckReport: crosscheck.getCrossCheckReport,
    getDblpName,
});

export async function controllerCrossCheckTeam(req, res) {
    const { source, pids, identityLinks: suppliedIdentityLinks } = req.body || {};
    if (!source || !Array.isArray(pids) || pids.length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing source or non-empty pids array' });
        return;
    }
    const confSource = confSourceFrom(req);
    const journalSource = journalSourceFrom(req);
    try {
        const identityLinks = parseIdentityLinks(suppliedIdentityLinks);
        const report = await getTeamCrossCheckReport({ source, pids }, { confSource, journalSource, identityLinks });
        // '/crosscheck/team' only, not '/internal/crosscheck/team' -- both
        // are POST (unlike crosscheck.js/crosscheckStructure.js's own
        // GET-vs-POST split, see routes.js), so req.route.path is what
        // distinguishes the token-protected public route from
        // CrossCheckTeam.js's own internal one, which already does this
        // filtering/correction work client-side.
        if (req.route.path === '/crosscheck/team') {
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
                const title = `DBLP → HAL cross-check for team`;
                const memberLabel = member => `${member.name || member.pid} (pid: ${member.pid}, idHal: ${member.idHal})`;
                const { contentType, body } = renderCrossCheckExportByMember(options.export, members, title, memberLabel);
                res.set('Content-Type', contentType).send(body);
                return;
            }
            res.json({ ...report, members, confirmedCount: totalConfirmedCount });
            return;
        }
        res.json(report);
    } catch (error) {
        console.log('Error during team cross-check computation', error);
        res.status(error instanceof IdentityLinksConflictError ? 409 : 400).json({ error: error.message });
    }
}
