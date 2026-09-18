import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamCrossChecker } from './crosscheckTeam.js';

// Builds a fake getCrossCheckReport response in the same shape
// crosscheck.js's own getCrossCheckReport produces (only the fields the
// aggregation actually reads).
function fakeReport({ confirmed = 0, toReview = 0 } = {}) {
    const results = [];
    for (let i = 0; i < confirmed; i++) results.push({ status: 'confirmed', publication: { dblp: { key: `c${i}` } }, matches: [] });
    for (let i = 0; i < toReview; i++) results.push({ status: 'to-review', publication: { dblp: { key: `r${i}` } }, matches: [] });
    return { dblpStatus: { version: 'v1', importedAt: '2026-01-01' }, halCacheNote: 'note', results };
}

test('getTeamCrossCheckReport: rejects an unknown source without calling anything', async () => {
    let called = false;
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async () => { called = true; return { idHal: null }; },
        resolveDblpIdentityForIdHal: async () => { called = true; return { pid: null }; },
        getCrossCheckReport: async () => { called = true; return null; },
        getDblpName: async () => { called = true; return null; },
    });
    await assert.rejects(
        () => resolveTeamCrossCheck({ source: 'orcid', pids: ['1/1'] }, { confSource: 'core', journalSource: 'sjr' }),
        /'dblp' or 'hal'/
    );
    assert.equal(called, false);
});

test('getTeamCrossCheckReport: aggregates resolved members, tags each result with member, sums confirmedCount', async () => {
    const identities = { '11/1262': { idHal: 'h1', name: 'Alice' }, '153/1422': { idHal: 'h2', name: 'Bob' } };
    const reports = { h1: fakeReport({ confirmed: 2, toReview: 1 }), h2: fakeReport({ confirmed: 1 }) };

    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async pid => identities[pid],
        getCrossCheckReport: async (pid, idHal) => reports[idHal],
        getDblpName: async () => null,
    });

    const report = await resolveTeamCrossCheck(
        { source: 'dblp', pids: ['11/1262', '153/1422'] },
        { confSource: 'core', journalSource: 'sjr' }
    );

    assert.equal(report.members.length, 2);
    assert.equal(report.unresolvedMembers.length, 0);
    assert.equal(report.confirmedCount, 3);
    assert.deepEqual(report.dblpStatus, { version: 'v1', importedAt: '2026-01-01' });

    const alice = report.members.find(m => m.pid === '11/1262');
    assert.equal(alice.idHal, 'h1');
    assert.equal(alice.name, 'Alice');
    assert.equal(alice.confirmedCount, 2);
    assert.equal(alice.results.length, 3);
    for (const result of alice.results) {
        assert.deepEqual(result.member, { pid: '11/1262', idHal: 'h1', name: 'Alice' });
    }
});

test('getTeamCrossCheckReport: a pid with no resolvable HAL identity is listed as unresolved, not crosschecked', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async () => ({ idHal: null }),
        getCrossCheckReport: async () => { throw new Error('should not be called'); },
        getDblpName: async () => null,
    });

    const report = await resolveTeamCrossCheck({ source: 'dblp', pids: ['230/1948'] }, { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].pid, '230/1948');
    assert.equal(report.confirmedCount, 0);
});

test('getTeamCrossCheckReport: mixes resolved and unresolved members in one report', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async pid => (pid === '11/1262' ? { idHal: 'h1', name: 'Alice' } : { idHal: null }),
        getCrossCheckReport: async () => fakeReport({ confirmed: 1 }),
        getDblpName: async () => null,
    });

    const report = await resolveTeamCrossCheck(
        { source: 'dblp', pids: ['11/1262', '999/9999'] },
        { confSource: 'core', journalSource: 'sjr' }
    );

    assert.equal(report.members.length, 1);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].pid, '999/9999');
    assert.equal(report.confirmedCount, 1);
});

test('getTeamCrossCheckReport: prefers the dblp name over the HAL-side identity name, and reports it for unresolved members too', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async pid => (pid === '11/1262' ? { idHal: 'h1', name: 'Alice (HAL)' } : { idHal: null }),
        getCrossCheckReport: async () => fakeReport({ confirmed: 1 }),
        getDblpName: async pid => (pid === '11/1262' ? 'Alice Dupont' : 'Bob Martin'),
    });

    const report = await resolveTeamCrossCheck(
        { source: 'dblp', pids: ['11/1262', '999/9999'] },
        { confSource: 'core', journalSource: 'sjr' }
    );

    assert.equal(report.members[0].name, 'Alice Dupont');
    assert.equal(report.unresolvedMembers[0].name, 'Bob Martin');
});

test('getTeamCrossCheckReport: a resolved identity whose pid getCrossCheckReport cannot find is reported as unresolved too', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveHalIdentityForPid: async () => ({ idHal: 'h1', name: 'Ghost' }),
        getCrossCheckReport: async () => null,
        getDblpName: async () => null,
    });

    const report = await resolveTeamCrossCheck({ source: 'dblp', pids: ['1/1'] }, { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].candidateIdHal, 'h1');
    assert.equal(report.unresolvedMembers[0].candidateName, 'Ghost');
});

// ****************************************************************************************************
// ****************************************************************************************************
// source: 'hal' -- same aggregation core, opposite resolution direction
// (raw idHal_s in, resolveDblpIdentityForIdHal instead of
// resolveHalIdentityForPid). Mirrors the dblp-sourced cases above.

test('getTeamCrossCheckReport (hal source): aggregates resolved members, tags each result with member, sums confirmedCount', async () => {
    const identities = { h1: { pid: '11/1262', name: 'Alice' }, h2: { pid: '153/1422' } };
    const reports = { '11/1262': fakeReport({ confirmed: 2, toReview: 1 }), '153/1422': fakeReport({ confirmed: 1 }) };

    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveDblpIdentityForIdHal: async idHal => identities[idHal],
        getCrossCheckReport: async pid => reports[pid],
        getDblpName: async pid => (pid === '11/1262' ? 'Alice Dupont' : null),
    });

    const report = await resolveTeamCrossCheck(
        { source: 'hal', pids: ['h1', 'h2'] },
        { confSource: 'core', journalSource: 'sjr' }
    );

    assert.equal(report.members.length, 2);
    assert.equal(report.unresolvedMembers.length, 0);
    assert.equal(report.confirmedCount, 3);
    assert.deepEqual(report.dblpStatus, { version: 'v1', importedAt: '2026-01-01' });

    const alice = report.members.find(m => m.idHal === 'h1');
    assert.equal(alice.pid, '11/1262');
    // dblpName ("Alice Dupont") wins over the identity's own name ("Alice"),
    // same precedence as the dblp-sourced direction.
    assert.equal(alice.name, 'Alice Dupont');
    assert.equal(alice.confirmedCount, 2);
    assert.equal(alice.results.length, 3);
    for (const result of alice.results) {
        assert.deepEqual(result.member, { pid: '11/1262', idHal: 'h1', name: 'Alice Dupont' });
    }

    const bob = report.members.find(m => m.idHal === 'h2');
    // No dblpName and no identity.name -- falls back to the idHal itself
    // rather than a blank name (see resolveHalSourcedMember).
    assert.equal(bob.name, 'h2');
});

test('getTeamCrossCheckReport (hal source): an idHal with no resolvable dblp pid is listed as unresolved, not crosschecked', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveDblpIdentityForIdHal: async () => ({ pid: null }),
        getCrossCheckReport: async () => { throw new Error('should not be called'); },
        getDblpName: async () => { throw new Error('should not be called without a pid'); },
    });

    const report = await resolveTeamCrossCheck({ source: 'hal', pids: ['ghost-idhal'] }, { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].idHal, 'ghost-idhal');
    assert.equal(report.unresolvedMembers[0].name, 'ghost-idhal');
    assert.equal(report.unresolvedMembers[0].candidatePid, null);
    assert.equal(report.confirmedCount, 0);
});

test('getTeamCrossCheckReport (hal source): mixes resolved and unresolved members in one report', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveDblpIdentityForIdHal: async idHal => (idHal === 'h1' ? { pid: '11/1262', name: 'Alice' } : { pid: null }),
        getCrossCheckReport: async () => fakeReport({ confirmed: 1 }),
        getDblpName: async () => 'Alice Dupont',
    });

    const report = await resolveTeamCrossCheck(
        { source: 'hal', pids: ['h1', 'h2'] },
        { confSource: 'core', journalSource: 'sjr' }
    );

    assert.equal(report.members.length, 1);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].idHal, 'h2');
    assert.equal(report.confirmedCount, 1);
});

test('getTeamCrossCheckReport (hal source): a resolved identity whose pid getCrossCheckReport cannot find is reported as unresolved too', async () => {
    const resolveTeamCrossCheck = createTeamCrossChecker({
        resolveDblpIdentityForIdHal: async () => ({ pid: '99/9999', name: 'Ghost' }),
        getCrossCheckReport: async () => null,
        getDblpName: async () => null,
    });

    const report = await resolveTeamCrossCheck({ source: 'hal', pids: ['h1'] }, { confSource: 'core', journalSource: 'sjr' });

    assert.equal(report.members.length, 0);
    assert.equal(report.unresolvedMembers.length, 1);
    assert.equal(report.unresolvedMembers[0].candidatePid, '99/9999');
    assert.equal(report.unresolvedMembers[0].candidateName, 'Ghost');
});

test('personal team links skip automatic identity lookups in both directions', async () => {
    const resolve = createTeamCrossChecker({
        resolveHalIdentityForPid: async () => { throw new Error('must use personal link'); },
        resolveDblpIdentityForIdHal: async () => { throw new Error('must use personal link'); },
        getDblpName: async () => 'Alice',
        getCrossCheckReport: async (pid, idHal) => {
            assert.equal(pid, 'p1'); assert.equal(idHal, 'h1');
            return { dblpStatus: {}, halCacheNote: '', results: [] };
        },
    });
    const identityLinks = { byIdHal: new Map([['h1', 'p1']]), byPid: new Map([['p1', 'h1']]) };
    for (const source of ['hal', 'dblp']) {
        const report = await resolve({ source, pids: [source === 'hal' ? 'h1' : 'p1'] }, { identityLinks });
        assert.equal(report.members.length, 1);
    }
});
