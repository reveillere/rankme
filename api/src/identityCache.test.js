import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityReportGetter, personLinksVersion } from './identityResolution.js';
import { createStructureCrossChecker } from './crosscheckStructure.js';

function fixture() {
    let links = [];
    let computations = 0;
    let beforeReturn = () => {};
    const cache = new Map();
    const dependencies = {
        getDblpStatus: async () => ({ version: 'v1' }),
        getPersonLinksVersion: async () => personLinksVersion(links),
        getCache: async key => cache.get(key) ?? null,
        setCache: async (key, value) => cache.set(key, value),
    };
    const getIdentityResolutionReport = createIdentityReportGetter({
        ...dependencies,
        resolveStructure: async () => {
            computations++;
            const link = links.find(l => l.idHal === 'alice');
            const report = [{ idHal: 'alice', name: 'Alice', resolved: link ? { ...link } : null,
                confidence: link ? 'confirmed' : 'not-found', candidates: [] }];
            beforeReturn();
            return report;
        },
    });
    const resolve = createStructureCrossChecker({
        ...dependencies,
        getIdentityResolutionReport,
        getCrossCheckReport: async pid => ({
            dblpStatus: { version: 'v1' }, halCacheNote: '',
            results: [{ status: 'confirmed', publication: { pid } }],
        }),
    });
    return {
        get: () => resolve('lab', { confSource: 'core', journalSource: 'sjr' }),
        setLinks: value => { links = value; },
        duringComputation: callback => { beforeReturn = callback; },
        computations: () => computations,
    };
}

test('both structure caches follow additions, replacements, deletion and imported/ORCID links', async () => {
    const f = fixture();
    const initial = await f.get();
    assert.equal(initial.unresolvedMembers.length, 1);
    assert.equal(await f.get(), initial);
    assert.equal(f.computations(), 1);

    for (const [pid, source] of [['1/1', 'manual'], ['2/2', 'manual'], ['3/3', 'orcid']]) {
        f.setLinks([{ idHal: 'alice', pid, source }]);
        const report = await f.get();
        assert.equal(report.unresolvedMembers.length, 0);
        assert.equal(report.members[0].pid, pid);
        assert.equal(report.members[0].results[0].publication.pid, pid);
        assert.equal(report.confirmedCount, 1);
        assert.equal(await f.get(), report);
    }
    f.setLinks([]);
    const deleted = await f.get();
    assert.equal(deleted.members.length, 0);
    assert.equal(deleted.unresolvedMembers.length, 1);
});

test('an identity edit during computation cannot cache the old report under the new identity version', async () => {
    const f = fixture();
    f.duringComputation(() => f.setLinks([{ idHal: 'alice', pid: 'new/pid', source: 'manual' }]));
    assert.equal((await f.get()).unresolvedMembers.length, 1);
    const refreshed = await f.get();
    assert.equal(refreshed.unresolvedMembers.length, 0);
    assert.equal(refreshed.members[0].pid, 'new/pid');
    assert.equal(f.computations(), 2);
});

test('identity fingerprint ignores database order and timestamps but includes link source', () => {
    const a = { idHal: 'alice', pid: '1/1', source: 'manual' };
    const b = { idHal: 'bob', pid: '2/2', source: 'orcid' };
    assert.equal(personLinksVersion([a, b]), personLinksVersion([b, { ...a, createdAt: 'today' }]));
    assert.notEqual(personLinksVersion([a]), personLinksVersion([{ ...a, source: 'orcid' }]));
});
