import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityResolver, arbitrate, createDblpIdentityResolver } from './identityResolution.js';

// Builds a resolver over an in-memory fake of every I/O dependency --
// same style as dblpSearchCache.test.js's fixture, so the arbitration and
// persistence rules can be exercised without a real Mongo/HAL behind them.
function fixture({ members, exactByName = new Map(), tokenCandidatesByName = new Map(), halOrcidsByIdHal = new Map(), existingLinks = new Map() }) {
    const savedLinks = [];
    const resolver = createIdentityResolver({
        getMemberNames: async () => members,
        getHalOrcids: async (idHals) => new Map(idHals.map(id => [id, halOrcidsByIdHal.get(id) || []])),
        findExactCandidates: async (names) => {
            const result = new Map();
            for (const name of names) if (exactByName.has(name)) result.set(name, exactByName.get(name));
            return result;
        },
        findTokenCandidates: async (name) => tokenCandidatesByName.get(name) || [],
        getPersonLinks: async (idHals) => new Map(idHals.filter(id => existingLinks.has(id)).map(id => [id, existingLinks.get(id)])),
        savePersonLink: async (idHal, pid) => {
            savedLinks.push({ idHal, pid });
            existingLinks.set(idHal, { pid, source: 'orcid' });
        },
    });
    return { resolver, savedLinks, existingLinks };
}

test('arbitrate: single candidate, matching orcid on both sides -> confirmed, orcid source', () => {
    const result = arbitrate([{ pid: 'p1', name: 'A One', orcid: '0000-0001-1111-1111' }], 'exact', new Set(['0000-0001-1111-1111']));
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.resolved, { pid: 'p1', source: 'orcid' });
});

test('arbitrate: multiple candidates, only one carries the shared HAL orcid -> confirmed', () => {
    const candidates = [
        { pid: 'p1', name: 'A One', orcid: null },
        { pid: 'p2', name: 'A One', orcid: '0000-0002-2222-2222' },
        { pid: 'p3', name: 'A One', orcid: '0000-0003-3333-3333' },
    ];
    const result = arbitrate(candidates, 'exact', new Set(['0000-0002-2222-2222']));
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.resolved, { pid: 'p2', source: 'orcid' });
});

test('arbitrate: single candidate found by exact name, no orcid on the dblp side -> probable, not persisted', () => {
    const result = arbitrate([{ pid: 'p1', name: 'A One', orcid: null }], 'exact', new Set());
    assert.equal(result.confidence, 'probable');
    assert.equal(result.resolved, null);
});

test('arbitrate: single candidate found only via the token fallback, no orcid -> to-review', () => {
    const result = arbitrate([{ pid: 'p1', name: 'A Variant', orcid: null }], 'tokens', new Set());
    assert.equal(result.confidence, 'to-review');
    assert.equal(result.resolved, null);
});

test('arbitrate: conflicting orcid (candidate carries a different orcid than the HAL member) is rejected, never auto-linked', () => {
    const result = arbitrate([{ pid: 'p1', name: 'A One', orcid: '0000-0009-9999-9999' }], 'exact', new Set(['0000-0001-1111-1111']));
    assert.notEqual(result.confidence, 'confirmed');
    assert.equal(result.resolved, null);
});

test('arbitrate: multiple candidates, none sharing the HAL orcid -> unresolved', () => {
    const candidates = [
        { pid: 'p1', name: 'A One', orcid: null },
        { pid: 'p2', name: 'A One', orcid: null },
    ];
    const result = arbitrate(candidates, 'exact', new Set(['0000-0001-1111-1111']));
    assert.equal(result.confidence, 'unresolved');
    assert.equal(result.resolved, null);
});

test('arbitrate: no candidate at all -> not-found', () => {
    const result = arbitrate([], 'exact', new Set());
    assert.equal(result.confidence, 'not-found');
    assert.equal(result.resolved, null);
});

test('arbitrate: orcidId_s carrying several values is treated as a set -- a candidate matching any one of them confirms', () => {
    const result = arbitrate(
        [{ pid: 'p1', name: 'A One', orcid: '0000-0002-2222-2222' }],
        'exact',
        new Set(['0000-0001-1111-1111', '0000-0002-2222-2222']),
    );
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.resolved, { pid: 'p1', source: 'orcid' });
});

test('resolveStructure: single exact-name candidate confirmed by orcid gets persisted as source orcid', async () => {
    const { resolver, savedLinks } = fixture({
        members: [{ idHal: 'idhal-1', name: 'Cyril Gavoille' }],
        exactByName: new Map([['Cyril Gavoille', [{ pid: '10/1000', name: 'Cyril Gavoille', orcid: '0000-0001-1111-1111' }]]]),
        halOrcidsByIdHal: new Map([['idhal-1', ['0000-0001-1111-1111']]]),
    });
    const [result] = await resolver('3102');
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.resolved, { pid: '10/1000', source: 'orcid' });
    assert.deepEqual(savedLinks, [{ idHal: 'idhal-1', pid: '10/1000' }]);
});

test('resolveStructure: a single exact-name candidate with no dblp orcid is reported as probable and never persisted', async () => {
    const { resolver, savedLinks } = fixture({
        members: [{ idHal: 'idhal-1', name: 'Cyril Gavoille' }],
        exactByName: new Map([['Cyril Gavoille', [{ pid: '10/1000', name: 'Cyril Gavoille', orcid: null }]]]),
    });
    const [result] = await resolver('3102');
    assert.equal(result.confidence, 'probable');
    assert.equal(result.resolved, null);
    assert.deepEqual(savedLinks, []);
});

test('resolveStructure: an existing manual personLink is never overwritten by an orcid-confirmed recompute', async () => {
    const { resolver, savedLinks, existingLinks } = fixture({
        members: [{ idHal: 'idhal-1', name: 'Cyril Gavoille' }],
        exactByName: new Map([['Cyril Gavoille', [{ pid: '10/9999', name: 'Cyril Gavoille', orcid: '0000-0001-1111-1111' }]]]),
        halOrcidsByIdHal: new Map([['idhal-1', ['0000-0001-1111-1111']]]),
        existingLinks: new Map([['idhal-1', { pid: '10/1000', source: 'manual' }]]),
    });
    const [result] = await resolver('3102');
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.resolved, { pid: '10/1000', source: 'manual' });
    // The pipeline never even ran a candidate search for an already-linked
    // member (see createIdentityResolver), so nothing was written either.
    assert.deepEqual(savedLinks, []);
    assert.deepEqual(existingLinks.get('idhal-1'), { pid: '10/1000', source: 'manual' });
});

test('resolveStructure: falls back to token candidates only when the exact-name step found nothing', async () => {
    const { resolver } = fixture({
        members: [{ idHal: 'idhal-1', name: 'Cyril Gavoille' }],
        exactByName: new Map(), // nothing found by exact name
        tokenCandidatesByName: new Map([['Cyril Gavoille', [{ pid: '10/1000', name: 'C. Gavoille', orcid: null }]]]),
    });
    const [result] = await resolver('3102');
    assert.equal(result.confidence, 'to-review');
    assert.deepEqual(result.candidates, [{ pid: '10/1000', name: 'C. Gavoille' }]);
});

test('resolveStructure: a member with no observed name is reported not-found without querying dblp', async () => {
    const { resolver } = fixture({ members: [{ idHal: 'idhal-1', name: null }] });
    const [result] = await resolver('3102');
    assert.equal(result.confidence, 'not-found');
    assert.equal(result.resolved, null);
});

function dblpResolverFixture({ existingLinks = new Map(), halOrcidByIdHal = new Map(), dblpMatchByOrcid = new Map() } = {}) {
    const savedLinks = [];
    const resolveDblpIdentityForIdHal = createDblpIdentityResolver({
        getPersonLink: async (idHal) => existingLinks.get(idHal) || null,
        getHalOrcid: async (idHal) => halOrcidByIdHal.get(idHal) || null,
        findDblpAuthorByOrcid: async (orcid) => dblpMatchByOrcid.get(orcid) || null,
        savePersonLink: async (idHal, pid) => {
            savedLinks.push({ idHal, pid });
            existingLinks.set(idHal, { pid, source: 'orcid' });
        },
    });
    return { resolveDblpIdentityForIdHal, savedLinks, existingLinks };
}

test('resolveDblpIdentityForIdHal: an existing personLink is returned directly, no orcid lookup performed', async () => {
    let orcidLookupCalled = false;
    const resolver = createDblpIdentityResolver({
        getPersonLink: async () => ({ pid: '10/1000', source: 'manual' }),
        getHalOrcid: async () => { orcidLookupCalled = true; return '0000-0001-1111-1111'; },
        findDblpAuthorByOrcid: async () => { orcidLookupCalled = true; return null; },
        savePersonLink: async () => { orcidLookupCalled = true; },
    });
    const result = await resolver('idhal-1');
    assert.deepEqual(result, { pid: '10/1000', source: 'manual' });
    assert.equal(orcidLookupCalled, false);
});

test('resolveDblpIdentityForIdHal: an orcid match is auto-saved and returned with source orcid', async () => {
    const { resolveDblpIdentityForIdHal, savedLinks, existingLinks } = dblpResolverFixture({
        halOrcidByIdHal: new Map([['idhal-1', '0000-0001-1111-1111']]),
        dblpMatchByOrcid: new Map([['0000-0001-1111-1111', { pid: '10/1000', name: 'Cyril Gavoille' }]]),
    });
    const result = await resolveDblpIdentityForIdHal('idhal-1');
    assert.deepEqual(result, { pid: '10/1000', name: 'Cyril Gavoille', source: 'orcid' });
    assert.deepEqual(savedLinks, [{ idHal: 'idhal-1', pid: '10/1000' }]);
    assert.deepEqual(existingLinks.get('idhal-1'), { pid: '10/1000', source: 'orcid' });
});

test('resolveDblpIdentityForIdHal: no HAL orcid, or no dblp match for it, resolves to pid: null and saves nothing', async () => {
    const { resolveDblpIdentityForIdHal: noOrcid, savedLinks: savedLinks1 } = dblpResolverFixture();
    assert.deepEqual(await noOrcid('idhal-1'), { pid: null });
    assert.deepEqual(savedLinks1, []);

    const { resolveDblpIdentityForIdHal: unmatchedOrcid, savedLinks: savedLinks2 } = dblpResolverFixture({
        halOrcidByIdHal: new Map([['idhal-1', '0000-0009-9999-9999']]),
    });
    assert.deepEqual(await unmatchedOrcid('idhal-1'), { pid: null });
    assert.deepEqual(savedLinks2, []);
});

test('resolveDblpIdentityForIdHal: an existing manual link short-circuits before ever reaching the orcid path, so it can never be overwritten', async () => {
    const { resolveDblpIdentityForIdHal, savedLinks } = dblpResolverFixture({
        existingLinks: new Map([['idhal-1', { pid: '10/1000', source: 'manual' }]]),
        halOrcidByIdHal: new Map([['idhal-1', '0000-0001-1111-1111']]),
        dblpMatchByOrcid: new Map([['0000-0001-1111-1111', { pid: '10/9999', name: 'Someone Else' }]]),
    });
    const result = await resolveDblpIdentityForIdHal('idhal-1');
    assert.deepEqual(result, { pid: '10/1000', source: 'manual' });
    assert.deepEqual(savedLinks, []);
});

test('production-style ORCID resolver works without any persistent link store', async () => {
    const resolve = createDblpIdentityResolver({
        getHalOrcid: async () => 'orcid',
        findDblpAuthorByOrcid: async () => ({ pid: 'p1', name: 'Alice' }),
    });
    assert.deepEqual(await resolve('h1'), { pid: 'p1', name: 'Alice', source: 'orcid' });
});
