import { createHash } from 'node:crypto';
import { getClient } from './db.js';
import * as cache from './cache.js';
import * as admin from './admin.js';
import * as hal from './hal.js';
import { tokenizeName, extractOrcid, getAuthorOrcid, findAuthorByOrcid } from './dblpLocal.js';

// ****************************************************************************************************
// ****************************************************************************************************
// Person-identity resolution: for a HAL lab (a "structure"), find which dblp
// pid corresponds to which idHal among its members. Independent of, and a
// prerequisite for, a future lab-wide crosscheck (crosscheck.js today only
// matches one already-identified author's own publications) -- this module
// stops at "who is who", it does not compare any publications.
//
// The core idea, settled after measuring a real lab (LaBRI, structId 3102):
// the NAME resolves (it's the only side with enough coverage to find
// candidates at all -- dblp's ORCID coverage measured 6-34% depending on the
// lab, nowhere near usable as a search key), the ORCID confirms (it's
// reliable when present on both sides, so it's the tie-breaker applied on
// top of name-found candidates, never the first lookup). See the per-case
// confidence table on arbitrate() below.

const HOMEPAGE_PREFIX = 'homepages/';

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toArray(value) {
    if (value == null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function firstOf(value) {
    return Array.isArray(value) ? value[0] : value;
}

async function getDblpDb() {
    const client = await getClient();
    return client.db('dblp');
}

// ****************************************************************************************************
// ****************************************************************************************************
// Pure resolution core, injected with its I/O so it can be unit-tested
// without a real Mongo/HAL/Redis behind it -- same shape as
// dblpSearchCache.js's createDblpSearch. Wired to the real dependencies
// below (fetchMemberNames, fetchExactCandidates, ...).

export function createIdentityResolver({ getMemberNames, getHalOrcids, findExactCandidates, findTokenCandidates, getPersonLinks, savePersonLink }) {
    return async function resolveStructure(structId) {
        const members = await getMemberNames(structId);
        const resultByIdHal = new Map();
        const toResolve = [];

        // One batched lookup for every member's existing link, instead of a
        // per-member round-trip -- same "step 0/1 batched, step 2 per-member
        // by necessity" shape as the toResolve loop below.
        const existingByIdHal = await getPersonLinks(members.filter(m => m.name).map(m => m.idHal));

        for (const member of members) {
            if (!member.name) {
                // A member idHal with no full name ever observed in the
                // lab's own publications -- shouldn't happen (see
                // fetchMemberNames: the name comes from the very same facet
                // that identifies the idHal as a member in the first
                // place), but there is nothing to search dblp by without
                // one, so this can only ever be not-found.
                resultByIdHal.set(member.idHal, { idHal: member.idHal, name: null, resolved: null, confidence: 'not-found', candidates: [] });
                continue;
            }
            // An existing link -- manual or a previous run's own
            // orcid-confirmed one -- is always reported as-is and never
            // recomputed: recomputing would risk silently overwriting a
            // human's manual correction (the one hard rule here), and a
            // previously orcid-confirmed link is exactly the kind of result
            // this whole pipeline exists to avoid paying for twice.
            const existing = existingByIdHal.get(member.idHal);
            if (existing) {
                resultByIdHal.set(member.idHal, { idHal: member.idHal, name: member.name, resolved: { pid: existing.pid, source: existing.source }, confidence: 'confirmed', candidates: [] });
                continue;
            }
            toResolve.push(member);
        }

        if (toResolve.length > 0) {
            // Step 0 (HAL ORCID) and step 1 (dblp exact-name match) are each
            // one batched call over every still-unresolved member -- never
            // per-member round-trips.
            const halOrcidsByIdHal = await getHalOrcids(toResolve.map(m => m.idHal));
            const exactByName = await findExactCandidates(toResolve.map(m => m.name));

            for (const member of toResolve) {
                const exactCandidates = exactByName.get(member.name) || [];
                // Step 2 (token fallback) only runs for a member that step 1
                // found nothing for -- and only then, per member (there is
                // no way to batch a $all-tokens query across different
                // members' distinct token sets the way step 1's $in can).
                const usingExact = exactCandidates.length > 0;
                const candidates = usingExact ? exactCandidates : await findTokenCandidates(member.name);
                const stage = usingExact ? 'exact' : 'tokens';

                const halOrcids = new Set(halOrcidsByIdHal.get(member.idHal) || []);
                const arbitration = arbitrate(candidates, stage, halOrcids);

                if (arbitration.confidence === 'confirmed') {
                    await savePersonLink(member.idHal, arbitration.resolved.pid);
                }
                resultByIdHal.set(member.idHal, { idHal: member.idHal, name: member.name, ...arbitration });
            }
        }

        return members.map(m => resultByIdHal.get(m.idHal));
    };
}

// Confidence arbitration, applied once per member on the candidates found by
// name (either stage). `halOrcids` is the set of ORCIDs HAL's own author
// referential has on file for this idHal (see getAuthorsInfo -- can be more
// than one for a single idHal, and can be empty). `candidates` never mixes
// stages: step 2 only runs when step 1 found nothing, so every candidate
// here comes from the one `stage` reported alongside it.
//
//   candidates   orcid situation                                confidence
//   ---------------------------------------------------------------------
//   1 (any stage) DBLP orcid matches a HAL orcid                confirmed
//   many          exactly one candidate's orcid matches a HAL orcid  confirmed
//   1, stage=exact DBLP has no orcid (or HAL has none to compare)    probable
//   1, stage=tokens same, but only found via the token fallback      to-review
//   many          none match (after dropping any orcid-conflicting
//                 candidate -- see below)                            unresolved
//   0             no candidate at all, from either stage             not-found
//
// A candidate whose orcid is present but differs from every HAL orcid on
// file is never a match -- but its mere absence of agreement is not treated
// as a contradiction of the OTHER candidates either: it is simply dropped
// before the rules above are applied to what remains. A DBLP candidate with
// no orcid at all is not a contradiction either (most dblp homepages simply
// don't carry one -- see the module header's coverage numbers) -- it is
// left in the pool, it just never confirms anything.
export function arbitrate(candidates, stage, halOrcids) {
    const report = candidates.map(({ pid, name }) => ({ pid, name }));
    if (candidates.length === 0) {
        return { resolved: null, confidence: 'not-found', candidates: report };
    }

    const hasOrcidData = halOrcids.size > 0;
    const matching = candidates.filter(c => c.orcid && halOrcids.has(c.orcid));
    const conflicting = candidates.filter(c => c.orcid && hasOrcidData && !halOrcids.has(c.orcid));

    if (matching.length === 1) {
        return { resolved: { pid: matching[0].pid, source: 'orcid' }, confidence: 'confirmed', candidates: report };
    }
    // More than one candidate sharing the same HAL-matching orcid has never
    // been observed (it would mean two distinct dblp homepages linked to
    // the same ORCID) -- treated defensively as unresolved rather than
    // picking one arbitrarily.
    if (matching.length > 1) {
        return { resolved: null, confidence: 'unresolved', candidates: report };
    }

    const remaining = candidates.filter(c => !conflicting.includes(c));
    if (remaining.length === 1) {
        return { resolved: null, confidence: stage === 'exact' ? 'probable' : 'to-review', candidates: report };
    }
    // remaining.length === 0 means every candidate was orcid-conflicting;
    // remaining.length > 1 means several survive with nothing to tell them
    // apart -- both are the same "found candidates, can't pick one" outcome.
    return { resolved: null, confidence: 'unresolved', candidates: report };
}

// ****************************************************************************************************
// ****************************************************************************************************
// Real I/O wired into createIdentityResolver above.

// authIdHalFullName_fs (parsed by hal.js's own parseAuthors, already exposed
// on every publication's `authors` field) is what identifies an idHal as a
// structure member in the first place (see hal.js's structureMembersOf) --
// so the first name observed for that idHal in the same publication set is
// guaranteed to be a real full name for them, no separate HAL lookup needed.
async function fetchMemberNames(structId) {
    const { publications, memberIds } = await hal.getStructurePublications(structId);
    const memberIdSet = new Set(memberIds);
    const nameByIdHal = new Map();
    for (const pub of publications) {
        for (const author of pub.authors) {
            if (author.idHal && memberIdSet.has(author.idHal) && !nameByIdHal.has(author.idHal)) {
                nameByIdHal.set(author.idHal, author.name);
            }
        }
    }
    return memberIds.map(idHal => ({ idHal, name: nameByIdHal.get(idHal) || null }));
}

function toCandidate(doc) {
    return {
        pid: doc._id.slice(HOMEPAGE_PREFIX.length),
        name: firstOf(doc.author),
        // Read off the very same `www` doc the name match already fetched
        // -- never a separate query. A reverse scan of `url` across the
        // whole collection was measured at ~5s for zero extra recall (every
        // hit it found was already reachable by name) -- see the module
        // header; extracting the orcid here, in memory, from a doc already
        // in hand costs nothing.
        orcid: extractOrcid(doc.url),
    };
}

// Step 1: exact match on the member's own observed full name, batched
// across every still-unresolved member in one query rather than one round
// trip each.
async function fetchExactCandidates(names) {
    const db = await getDblpDb();
    const docs = await db.collection('www')
        .find({ _id: { $regex: `^${HOMEPAGE_PREFIX}` }, author: { $in: names } }, { projection: { author: 1, url: 1 } })
        .toArray();

    const nameSet = new Set(names);
    const byName = new Map();
    for (const doc of docs) {
        const candidate = toCandidate(doc);
        for (const author of toArray(doc.author)) {
            if (!nameSet.has(author)) continue;
            if (!byName.has(author)) byName.set(author, []);
            byName.get(author).push(candidate);
        }
    }
    return byName;
}

// Step 2, per still-unresolved member only: same authorTokens field/query
// shape as dblpLocal.js's searchAuthorsByName (kept separate from it here
// since that function's own return shape -- author/pid/affiliation, no url
// -- is a public API contract for the DBLP search tab and doesn't carry
// what's needed to extract an orcid).
async function fetchTokenCandidates(name) {
    const words = tokenizeName(name);
    if (words.length === 0) return [];
    const db = await getDblpDb();
    const docs = await db.collection('www')
        .find({
            _id: { $regex: `^${HOMEPAGE_PREFIX}` },
            authorTokens: { $all: words.map(w => new RegExp('^' + escapeRegex(w))) },
        }, { projection: { author: 1, url: 1 } })
        .toArray();
    return docs.map(toCandidate);
}

// personLinks: one document per idHal, `source` distinguishing a human's
// manual confirmation from this pipeline's own orcid-confirmed result --
// see createIdentityResolver above for why an existing document of either
// source is never recomputed, and controllerRecordLink below for the only
// path that writes 'manual'.
let personLinksIndexEnsured = false;
async function personLinksCollection() {
    const client = await getClient();
    const col = client.db('rankme').collection('personLinks');
    if (!personLinksIndexEnsured) {
        personLinksIndexEnsured = true;
        col.createIndex({ idHal: 1 }, { unique: true })
            .catch(error => console.error('[identityResolution] Error creating personLinks index', error));
    }
    return col;
}

async function fetchPersonLink(idHal) {
    const col = await personLinksCollection();
    const doc = await col.findOne({ idHal });
    return doc ? { pid: doc.pid, source: doc.source } : null;
}

// Reverse lookup of fetchPersonLink above, keyed by dblp pid instead of
// idHal -- used by controllerSuggestIdentity below to check whether this
// dblp author already has a confirmed HAL identity (manual or a past
// orcid-confirmed one) before ever considering a fresh ORCID lookup. No
// index on `pid` (unlike idHal_s's unique index): this collection is one
// row per idHal, so a `pid` can appear at most as many times as there are
// idHal_s in the whole collection -- not worth a second index for a lookup
// that only ever runs interactively, once per author page visit.
export async function fetchPersonLinkByPid(pid) {
    const col = await personLinksCollection();
    const doc = await col.findOne({ pid });
    return doc ? { idHal: doc.idHal, source: doc.source } : null;
}

async function fetchPersonLinksByIdHals(idHals) {
    if (idHals.length === 0) return new Map();
    const col = await personLinksCollection();
    const docs = await col.find(
        { idHal: { $in: idHals } },
        { projection: { _id: 0, idHal: 1, pid: 1, source: 1 } },
    ).toArray();
    return new Map(docs.map(doc => [doc.idHal, { pid: doc.pid, source: doc.source }]));
}

async function fetchPersonLinksByPids(pids) {
    if (pids.length === 0) return new Map();
    const col = await personLinksCollection();
    const docs = await col.find(
        { pid: { $in: pids } },
        { projection: { _id: 0, idHal: 1, pid: 1, source: 1 } },
    ).toArray();
    return new Map(docs.map(doc => [doc.pid, { idHal: doc.idHal, source: doc.source }]));
}

async function saveOrcidPersonLink(idHal, pid) {
    const col = await personLinksCollection();
    await col.updateOne({ idHal }, { $set: { idHal, pid, source: 'orcid', createdAt: new Date() } }, { upsert: true });
}

const resolveStructureCore = createIdentityResolver({
    getMemberNames: fetchMemberNames,
    getHalOrcids: hal.getAuthorsInfo,
    findExactCandidates: fetchExactCandidates,
    findTokenCandidates: fetchTokenCandidates,
    getPersonLinks: fetchPersonLinksByIdHals,
    savePersonLink: saveOrcidPersonLink,
});

// The structure dialog needs the DBLP-side display name next to a confirmed
// pid. Fetch them in one local-Mongo query for the complete report instead
// of doing one homepage lookup per member.
async function fetchDblpNames(pids) {
    if (pids.length === 0) return new Map();
    const db = await getDblpDb();
    const docs = await db.collection('www').find(
        { _id: { $in: pids.map(pid => `${HOMEPAGE_PREFIX}${pid}`) } },
        { projection: { author: 1 } }
    ).toArray();
    return new Map(docs.map(doc => [doc._id.slice(HOMEPAGE_PREFIX.length), firstOf(doc.author)]));
}

async function resolveStructureWithDblpNames(structId) {
    const report = await resolveStructureCore(structId);
    const names = await fetchDblpNames(report.flatMap(member => member.resolved?.pid ? [member.resolved.pid] : []));
    return report.map(member => member.resolved
        ? { ...member, resolved: { ...member.resolved, name: names.get(member.resolved.pid) || null } }
        : member);
}

// ****************************************************************************************************
// ****************************************************************************************************

const CACHE_TTL_S = 60 * 60; // 1h -- short-lived on purpose, same rationale as crosscheck.js's own
                              // report cache: members already linked (manual or a previous orcid
                              // confirmation) are a cheap Mongo lookup each, not an expensive
                              // re-fetch, so there is little being saved beyond the matching work itself.

// Read Mongo directly: this fingerprint covers manual writes, imports, deletes
// and automatic ORCID links, including changes made by another API process.
// Global invalidation is intentional: personLinks is small, and this avoids
// maintaining a reverse index of every structure containing a person.
export function personLinksVersion(links) {
    const rows = links.map(({ idHal, pid, source }) => JSON.stringify([idHal, pid, source])).sort();
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export async function getPersonLinksVersion() {
    const col = await personLinksCollection();
    const links = await col.find({}, { projection: { _id: 0, idHal: 1, pid: 1, source: 1 } }).toArray();
    return personLinksVersion(links);
}

export function createIdentityReportGetter({ getDblpStatus, getPersonLinksVersion, resolveStructure, getCache, setCache }) {
    return async function getIdentityReport(structId) {
        const dblpStatus = await getDblpStatus();
        const linksVersion = await getPersonLinksVersion();
        const key = `identity:structure:v2:${structId}:${dblpStatus.version}:${linksVersion}`;
        const cached = await getCache(key);
        if (cached !== null) return cached;

        const report = await resolveStructure(structId);
        // Keep the version read BEFORE computation: a concurrent identity
        // edit must never publish an old report under the new version.
        await setCache(key, report, CACHE_TTL_S);
        return report;
    };
}

export const getIdentityResolutionReport = createIdentityReportGetter({
    getDblpStatus: admin.getDblpStatus,
    getPersonLinksVersion,
    resolveStructure: resolveStructureWithDblpNames,
    getCache: cache.get,
    setCache: cache.set,
});

export async function controllerResolveStructure(req, res) {
    const structId = req.params.structId;
    try {
        const report = await getIdentityResolutionReport(structId);
        res.json(report);
    } catch (error) {
        console.error('Error during identity-resolution computation', error);
        res.status(400).json({ error: error.message });
    }
}

// Same resolver used for a structure, but the member list is supplied by a
// client-side team. HAL teams therefore get the identical name+ORCID logic.
async function resolveHalTeamMembers(members) {
    const result = new Map();
    const pending = [];
    const existingByIdHal = await fetchPersonLinksByIdHals(members.map(member => member.id));
    for (const member of members) {
        const existing = existingByIdHal.get(member.id);
        if (existing) result.set(member.id, { idHal: member.id, name: member.name, resolved: { pid: existing.pid, source: existing.source }, confidence: 'confirmed', candidates: [] });
        else pending.push(member);
    }
    const [orcids, exact] = await Promise.all([hal.getAuthorsInfo(pending.map(m => m.id)), fetchExactCandidates(pending.map(m => m.name).filter(Boolean))]);
    for (const member of pending) {
        if (!member.name) { result.set(member.id, { idHal: member.id, name: null, resolved: null, confidence: 'not-found', candidates: [] }); continue; }
        const exactCandidates = exact.get(member.name) || [];
        const candidates = exactCandidates.length ? exactCandidates : await fetchTokenCandidates(member.name);
        const arbitration = arbitrate(candidates, exactCandidates.length ? 'exact' : 'tokens', new Set(orcids.get(member.id) || []));
        if (arbitration.confidence === 'confirmed') await saveOrcidPersonLink(member.id, arbitration.resolved.pid);
        result.set(member.id, { idHal: member.id, name: member.name, ...arbitration });
    }
    const report = members.map(member => result.get(member.id));
    const names = await fetchDblpNames(report.flatMap(member => member.resolved?.pid ? [member.resolved.pid] : []));
    return report.map(member => member.resolved
        ? { ...member, resolved: { ...member.resolved, name: names.get(member.resolved.pid) || null } }
        : member);
}

async function resolveDblpTeamMembers(members) {
    const names = await fetchDblpNames(members.map(member => member.id));
    const existingByPid = await fetchPersonLinksByPids(members.map(member => member.id));
    const existingInfos = await hal.getAuthorInfos([...existingByPid.values()].map(link => link.idHal));
    const pending = members.filter(member => !existingByPid.has(member.id));
    const orcidByPid = new Map(await Promise.all(pending.map(async member => [member.id, await getAuthorOrcid(member.id)])));
    const halByOrcid = await hal.findAuthorsByOrcid([...orcidByPid.values()]);
    const namesToSearch = pending
        .filter(member => !halByOrcid.get(orcidByPid.get(member.id)))
        .map(member => names.get(member.id) || member.name || null);
    const candidatesByName = await hal.searchAuthorsByNames(namesToSearch);

    return Promise.all(members.map(async member => {
        const name = names.get(member.id) || member.name || null;
        const existing = existingByPid.get(member.id);
        if (existing) {
            const halInfo = existingInfos.get(existing.idHal);
            return { pid: member.id, name, resolved: { idHal: existing.idHal, name: halInfo?.name || null, source: existing.source }, confidence: 'confirmed', candidates: [] };
        }
        const orcidMatch = halByOrcid.get(orcidByPid.get(member.id));
        if (orcidMatch) {
            await saveOrcidPersonLink(orcidMatch.idHal, member.id);
            return { pid: member.id, name, resolved: { idHal: orcidMatch.idHal, name: orcidMatch.name, source: 'orcid' }, confidence: 'confirmed', candidates: [] };
        }
        const candidates = name ? (candidatesByName.get(name) || []).map(candidate => ({ idHal: candidate.id, name: candidate.author })) : [];
        return { pid: member.id, name, resolved: null, confidence: candidates.length ? 'unresolved' : 'not-found', candidates };
    }));
}

export async function controllerResolveTeam(req, res) {
    const { source, members } = req.body || {};
    if (!['hal', 'dblp'].includes(source) || !Array.isArray(members)) return res.status(400).json({ error: 'Bad Request' });
    try { res.json(source === 'hal' ? await resolveHalTeamMembers(members) : await resolveDblpTeamMembers(members)); }
    catch (error) { console.error('Error resolving team identities', error); res.status(400).json({ error: error.message }); }
}

// Manual confirmation, on the model of matchOverrides.js's controllerRecord:
// always writes 'manual', regardless of any existing link or its confidence
// -- a human confirming an identity always outranks whatever this pipeline
// last computed automatically.
export async function controllerRecordLink(req, res) {
    const { idHal, pid } = req.body || {};
    if (typeof idHal !== 'string' || !idHal.trim() || typeof pid !== 'string' || !pid.trim()) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing idHal or pid' });
        return;
    }
    try {
        const col = await personLinksCollection();
        await col.updateOne({ idHal }, { $set: { idHal, pid, source: 'manual', createdAt: new Date() } }, { upsert: true });
        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('[identityResolution] Error recording manual link', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

// ****************************************************************************************************
// ****************************************************************************************************
// Direct management of personLinks, independent of the cross-check flow
// above (controllerRecordLink is still how a single link gets created or
// re-pointed to a different pid -- these three just list/delete/bulk-import
// what's already on file). All three take `idHal`/`pid` values straight
// from the client (a team's or structure's already-loaded member list), so
// there is no structId/team to re-derive membership from here -- unlike
// resolveStructure above, this never touches HAL or dblp at all.

// Comma-separated query params, not JSON body: this is a GET, meant to be
// callable from a plain browser navigation/curl as easily as from the panel
// itself, and the id lists here are bounded by a team/structure's own
// membership (at most a few hundred), nowhere near a URL length concern.
function splitCsvParam(value) {
    if (!value) return [];
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

// Pure cores below, each injected with just the one collection method it
// needs -- same "pure core, injected I/O" style as createIdentityResolver
// above, so they can be unit-tested against a bare in-memory fake of
// find/deleteOne/updateOne instead of a real Mongo collection. The
// controllers further down are the only callers, wiring in the real
// personLinksCollection().

export async function listLinksCore(col, { idHals, pids }) {
    const or = [];
    if (idHals.length > 0) or.push({ idHal: { $in: idHals } });
    if (pids.length > 0) or.push({ pid: { $in: pids } });
    return col.find({ $or: or }, { projection: { _id: 0, idHal: 1, pid: 1, source: 1, createdAt: 1 } }).toArray();
}

export async function deleteLinkCore(col, idHal) {
    const result = await col.deleteOne({ idHal });
    return result.deletedCount > 0;
}

// Bulk sibling of controllerRecordLink above -- same 'manual' source (a
// file import is as much a human's explicit confirmation as one entry typed
// into the dialog) but tolerant of a batch containing a few bad rows: an
// import of a hand-edited or hand-exported JSON file shouldn't be all-or-
// nothing over one typo, so invalid entries are just skipped and counted
// rather than aborting the request.
export async function importLinksCore(col, links) {
    let imported = 0;
    let skipped = 0;
    for (const entry of links) {
        const idHal = entry?.idHal;
        const pid = entry?.pid;
        if (typeof idHal !== 'string' || !idHal.trim() || typeof pid !== 'string' || !pid.trim()) {
            skipped++;
            continue;
        }
        await col.updateOne({ idHal }, { $set: { idHal, pid, source: 'manual', createdAt: new Date() } }, { upsert: true });
        imported++;
    }
    return { imported, skipped };
}

export async function controllerListLinks(req, res) {
    const idHals = splitCsvParam(req.query.idHals);
    const pids = splitCsvParam(req.query.pids);
    if (idHals.length === 0 && pids.length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'At least one of idHals or pids is required' });
        return;
    }
    try {
        const docs = await listLinksCore(await personLinksCollection(), { idHals, pids });
        res.json(docs);
    } catch (error) {
        console.error('[identityResolution] Error listing links', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

export async function controllerDeleteLink(req, res) {
    const { idHal } = req.body || {};
    if (typeof idHal !== 'string' || !idHal.trim()) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing idHal' });
        return;
    }
    try {
        const deleted = await deleteLinkCore(await personLinksCollection(), idHal);
        if (!deleted) {
            res.status(404).json({ error: 'Not Found', message: `No link for idHal ${idHal}` });
            return;
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('[identityResolution] Error deleting link', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

export async function controllerImportLinks(req, res) {
    const { links } = req.body || {};
    if (!Array.isArray(links)) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing links array' });
        return;
    }
    try {
        const { imported, skipped } = await importLinksCore(await personLinksCollection(), links);
        res.status(201).json({ imported, skipped });
    } catch (error) {
        console.error('[identityResolution] Error importing links', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}

// Single-author sibling of resolveStructure above, for any flow that has a
// bare dblp pid and no HAL structure to enumerate a membership from -- the
// DBLP author page's "Cross-check with HAL" flow (Author.js/
// CrossCheckDialog.js, via controllerSuggestIdentity below) and, since it
// was extracted, crosscheckTeam.js's per-member resolution (a rankme team
// is just a client-side list of pids, with no membership to run
// resolveStructure's name-match pipeline over either). ORCID is the only
// signal available for a single, out-of-context pid.
//
// An ORCID match found here is auto-confirmed and persisted, same policy
// arbitrate() already applies for a whole-structure resolution: an ORCID
// agreeing on both sides is reliable enough on its own to skip the manual
// confirmation step (controllerRecordLink) entirely, rather than only ever
// surfacing it as a suggestion for a human to click through.
export async function resolveHalIdentityForPid(pid) {
    const existing = await fetchPersonLinkByPid(pid);
    if (existing) {
        return { idHal: existing.idHal, source: existing.source };
    }

    // getAuthorOrcid already returns the bare ORCID (see dblpLocal.js's
    // extractOrcid) -- the same bare form ref/author's own orcidId_s is
    // stored in, so no https://orcid.org/ stripping is needed here (only
    // dblp.js's own /author-info endpoint adds that prefix, for display).
    const orcid = await getAuthorOrcid(pid);
    if (orcid) {
        const match = await hal.findAuthorByOrcid(orcid);
        if (match) {
            // saveOrcidPersonLink upserts keyed on idHal (personLinks' own
            // unique index) -- but the existing-link check just above
            // (fetchPersonLinkByPid) is keyed on pid, a DIFFERENT field. A
            // manual link already on file for this exact idHal (e.g. linked
            // to some other pid entirely) would otherwise be silently
            // overwritten by the save below -- guard on idHal itself, the
            // same key the write uses, right before calling it.
            // (createIdentityResolver/resolveStructure doesn't need this
            // extra check: its own existing-link lookup is already keyed on
            // idHal, the same key its own savePersonLink call writes.)
            const alreadyLinked = await fetchPersonLink(match.idHal);
            if (!alreadyLinked) {
                await saveOrcidPersonLink(match.idHal, pid);
            }
            return { idHal: match.idHal, name: match.name, source: 'orcid' };
        }
    }

    return { idHal: null };
}

// Reverse sibling of resolveHalIdentityForPid above: same idea, opposite
// direction -- given a HAL idHal with no dblp pid on file yet, find the
// dblp pid whose own homepage ORCID matches this idHal's HAL ORCID. Backs
// the future "Cross-check with DBLP" action on a HAL author page
// (AuthorHal.js, via controllerSuggestDblpIdentity below) and
// crosscheckTeam.js's own HAL-sourced team resolution.
//
// Unlike resolveHalIdentityForPid's dblp-side lookup (a cheap indexed _id
// lookup via getAuthorOrcid), the dblp-side ORCID scan here
// (dblpLocal.findAuthorByOrcid) is an unindexed ~4.2M-doc collection scan --
// see that function's own comment for why paying ~5s once, interactively,
// is acceptable here (this is never called in a lab-wide batch).
//
// Built the same "pure core, injected I/O" way as createIdentityResolver
// above, so it can be unit-tested without a real Mongo/HAL behind it --
// unlike resolveHalIdentityForPid, which has no such tests yet and is left
// as a plain function wired straight to its real dependencies.
export function createDblpIdentityResolver({ getPersonLink, getHalOrcid, findDblpAuthorByOrcid, savePersonLink }) {
    return async function resolveDblpIdentityForIdHal(idHal) {
        const existing = await getPersonLink(idHal);
        if (existing) {
            return { pid: existing.pid, source: existing.source };
        }

        const orcid = await getHalOrcid(idHal);
        if (orcid) {
            const match = await findDblpAuthorByOrcid(orcid);
            if (match) {
                // Same auto-confirm policy as resolveHalIdentityForPid above
                // -- and no idHal/pid key mismatch to guard against here:
                // the existing-link check just above is already keyed on
                // idHal, the very key savePersonLink writes.
                await savePersonLink(idHal, match.pid);
                return { pid: match.pid, name: match.name, source: 'orcid' };
            }
        }

        return { pid: null };
    };
}

export const resolveDblpIdentityForIdHal = createDblpIdentityResolver({
    getPersonLink: fetchPersonLink,
    // hal.getAuthorInfo's own orcid field is already bare (ref/author's
    // orcidId_s -- see hal.js's findAuthorByOrcid comment for the same
    // convention), no https://orcid.org/ prefix to strip here.
    getHalOrcid: async (idHal) => (await hal.getAuthorInfo(idHal)).orcid,
    findDblpAuthorByOrcid: findAuthorByOrcid,
    savePersonLink: saveOrcidPersonLink,
});

export async function controllerSuggestIdentity(req, res) {
    // Wildcard route (same as dblp.js's controllerAuthorInfo) -- a dblp pid
    // routinely contains slashes (e.g. "10/1000", "l/LaurentReveillere"), so
    // it can't be captured as a plain :pid route param.
    const pid = req.params[0];
    try {
        const suggestion = await resolveHalIdentityForPid(pid);
        res.json(suggestion);
    } catch (error) {
        console.error('[identityResolution] Error computing identity suggestion', error);
        res.status(400).json({ error: error.message });
    }
}

// Reverse sibling of controllerSuggestIdentity above, for the future
// "Cross-check with DBLP" button on a HAL author page (AuthorHal.js). An
// idHal never contains a slash (unlike a dblp pid), so a plain :idHal route
// param works fine here -- no wildcard route needed.
export async function controllerSuggestDblpIdentity(req, res) {
    const idHal = req.params.idHal;
    try {
        const suggestion = await resolveDblpIdentityForIdHal(idHal);
        res.json(suggestion);
    } catch (error) {
        console.error('[identityResolution] Error computing dblp identity suggestion', error);
        res.status(400).json({ error: error.message });
    }
}
