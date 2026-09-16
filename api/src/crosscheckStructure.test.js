import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStructureCrossChecker } from './crosscheckStructure.js';

// Builds a fake getCrossCheckReport response in the same shape
// crosscheck.js's own getCrossCheckReport produces (only the fields the
// aggregation actually reads) -- same helper as crosscheckTeam.test.js's own.
function fakeReport({ confirmed = 0, toReview = 0 } = {}) {
    const results = [];
    for (let i = 0; i < confirmed; i++) results.push({ status: 'confirmed', publication: { dblp: { key: `c${i}` } }, matches: [] });
    for (let i = 0; i < toReview; i++) results.push({ status: 'to-review', publication: { dblp: { key: `r${i}` } }, matches: [] });
    return { dblpStatus: { version: 'v1', importedAt: '2026-01-01' }, halCacheNote: 'note', results };
}

// A no-op cache (always a miss, set is a no-op) -- most tests below aren't
// about caching, so they can ignore it entirely via this default.
function noCache() {
    return { getCache: async () => null, setCache: async () => {} };
}

test('getStructureCrossCheckReport: a cache hit is returned as-is, without calling any other dependency', async () => {
    let called = false;
    const cached = { dblpStatus: { version: 'v1' }, halCacheNote: null, members: [], unresolvedMembers: [], confirmedCount: 0 };
    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => { called = true; return []; },
        getCrossCheckReport: async () => { called = true; return null; },
        getDblpStatus: async () => ({ version: 'v1', importedAt: '2026-01-01' }),
        getCache: async () => cached,
        setCache: async () => { called = true; },
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report, cached);
    assert.equal(called, false);
});

test('getStructureCrossCheckReport: aggregates resolved members, tags each result with member, sums confirmedCount', async () => {
    const identityReport = [
        { idHal: 'h1', name: 'Alice', resolved: { pid: '11/1262', source: 'orcid' }, confidence: 'confirmed', candidates: [] },
        { idHal: 'h2', name: 'Bob', resolved: { pid: '153/1422', source: 'manual' }, confidence: 'confirmed', candidates: [] },
    ];
    const reports = { h1: fakeReport({ confirmed: 2, toReview: 1 }), h2: fakeReport({ confirmed: 1 }) };
    const { getCache, setCache } = noCache();

    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => identityReport,
        getCrossCheckReport: async (pid, idHal) => reports[idHal],
        getDblpStatus: async () => ({ version: 'v1', importedAt: '2026-01-01' }),
        getCache,
        setCache,
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 2);
    assert.equal(report.unresolvedMembers.length, 0);
    assert.equal(report.confirmedCount, 3);
    assert.deepEqual(report.dblpStatus, { version: 'v1', importedAt: '2026-01-01' });
    assert.equal(report.halCacheNote, 'note');

    const alice = report.members.find(m => m.idHal === 'h1');
    assert.equal(alice.pid, '11/1262');
    assert.equal(alice.name, 'Alice');
    assert.equal(alice.confirmedCount, 2);
    assert.equal(alice.results.length, 3);
    for (const result of alice.results) {
        assert.deepEqual(result.member, { idHal: 'h1', name: 'Alice', pid: '11/1262' });
    }
});

test('getStructureCrossCheckReport: a member identityResolution could not resolve a pid for is kept separate, not crosschecked', async () => {
    const identityReport = [
        { idHal: 'h1', name: 'Carol', resolved: null, confidence: 'to-review', candidates: [{ pid: '1/1', name: 'Carol Something' }] },
    ];
    const { getCache, setCache } = noCache();

    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => identityReport,
        getCrossCheckReport: async () => { throw new Error('should not be called'); },
        getDblpStatus: async () => ({ version: 'v1', importedAt: '2026-01-01' }),
        getCache,
        setCache,
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].idHal, 'h1');
    assert.equal(report.unresolvedMembers[0].name, 'Carol');
    assert.deepEqual(report.unresolvedMembers[0].candidates, [{ pid: '1/1', name: 'Carol Something' }]);
    assert.equal(report.confirmedCount, 0);
});

test('getStructureCrossCheckReport: mixes resolved and unresolved members in one report', async () => {
    const identityReport = [
        { idHal: 'h1', name: 'Alice', resolved: { pid: '11/1262', source: 'orcid' }, confidence: 'confirmed', candidates: [] },
        { idHal: 'h2', name: 'Dan', resolved: null, confidence: 'not-found', candidates: [] },
    ];
    const { getCache, setCache } = noCache();

    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => identityReport,
        getCrossCheckReport: async () => fakeReport({ confirmed: 1 }),
        getDblpStatus: async () => ({ version: 'v1', importedAt: '2026-01-01' }),
        getCache,
        setCache,
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 1);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].idHal, 'h2');
    assert.equal(report.confirmedCount, 1);
});

test('getStructureCrossCheckReport: a resolved pid getCrossCheckReport cannot find (stale link) is skipped entirely, neither confirmed nor listed as unresolved', async () => {
    const identityReport = [
        { idHal: 'h1', name: 'Ghost', resolved: { pid: '999/9999', source: 'manual' }, confidence: 'confirmed', candidates: [] },
    ];
    const { getCache, setCache } = noCache();

    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => identityReport,
        getCrossCheckReport: async () => null,
        getDblpStatus: async () => ({ version: 'v1', importedAt: '2026-01-01' }),
        getCache,
        setCache,
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 0);
    assert.equal(report.confirmedCount, 0);
    // No member report ever landed, so dblpStatus/halCacheNote fall back to
    // the dump's own status directly instead of being left null.
    assert.deepEqual(report.dblpStatus, { version: 'v1', importedAt: '2026-01-01' });
    assert.equal(report.halCacheNote, 'HAL data may be up to 24h stale');
});

test('getStructureCrossCheckReport: caches the computed report under a key scoped by structId, dump version and ranking sources', async () => {
    const identityReport = [{ idHal: 'h1', name: 'Alice', resolved: { pid: '11/1262', source: 'orcid' }, confidence: 'confirmed', candidates: [] }];
    let setKey = null;
    let setValue = null;
    let setTtl = null;

    const resolveStructureCrossCheck = createStructureCrossChecker({
        getIdentityResolutionReport: async () => identityReport,
        getCrossCheckReport: async () => fakeReport({ confirmed: 1 }),
        getDblpStatus: async () => ({ version: 'v42', importedAt: '2026-01-01' }),
        getCache: async () => null,
        setCache: async (key, value, ttl) => { setKey = key; setValue = value; setTtl = ttl; },
    });

    const report = await resolveStructureCrossCheck('struct1', { confSource: 'core', journalSource: 'sjr' });

    assert.equal(setKey, 'crosscheck:structure:struct1:v42:core:sjr');
    assert.equal(setValue, report);
    assert.equal(setTtl, 60 * 60);
});
