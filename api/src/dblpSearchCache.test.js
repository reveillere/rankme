import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDblpSearch } from './dblpSearchCache.js';

function fixture() {
    let status = { ready: true, version: 'v1', importedAt: 'first' };
    let now = 0;
    let calls = 0;
    const entries = new Map();
    const cache = {
        async get(key) {
            const entry = entries.get(key);
            return entry && entry.expires > now ? entry.value : null;
        },
        async set(key, value, ttl) { entries.set(key, { value, expires: now + ttl }); },
    };
    const deps = {
        getStatus: async () => status,
        tokenize: query => query.toLowerCase().trim().split(/\s+/),
        search: async () => { calls++; return [{ pid: String(calls) }]; },
        cache,
    };
    return {
        deps, entries,
        setStatus: value => { status = { ...status, ...value }; },
        advance: seconds => { now += seconds; },
        calls: () => calls,
    };
}

test('concurrent equivalent searches share work, including cache reads; results expire after five minutes', async () => {
    const f = fixture();
    const search = createDblpSearch(f.deps);
    const results = await Promise.all([search('Alice Smith'), search(' SMITH alice '), search('alice smith')]);
    assert.equal(f.calls(), 1);
    assert.deepEqual(results[0], results[1]);
    f.advance(299);
    await search('alice smith');
    assert.equal(f.calls(), 1);
    f.advance(1);
    await search('alice smith');
    assert.equal(f.calls(), 2);
});

test('import blocks cache hits and a new import time invalidates even an unchanged version', async () => {
    const f = fixture();
    const search = createDblpSearch(f.deps);
    await search('alice');
    f.setStatus({ ready: false, importing: true });
    await assert.rejects(search('alice'), { status: 503 });
    f.setStatus({ ready: true, importing: false, importedAt: 'second' });
    assert.deepEqual(await search('alice'), [{ pid: '2' }]);
    f.setStatus({ version: 'v2' });
    await search('alice');
    assert.equal(f.calls(), 3);
});

test('an import beginning during a search prevents serving and caching its result', async () => {
    const f = fixture();
    f.deps.search = async () => { f.setStatus({ ready: false, importing: true }); return []; };
    const search = createDblpSearch(f.deps);
    await assert.rejects(search('alice'), { status: 503 });
    assert.equal(f.entries.size, 0);
});

test('failed searches can be retried and empty results are cached', async () => {
    const f = fixture();
    let attempts = 0;
    f.deps.search = async () => { if (++attempts === 1) throw new Error('Mongo unavailable'); return []; };
    const search = createDblpSearch(f.deps);
    await assert.rejects(search('alice'), /Mongo unavailable/);
    assert.deepEqual(await search('alice'), []);
    await search('alice');
    assert.equal(attempts, 2);
});

test('Redis read or write failures do not prevent a local search', async () => {
    const f = fixture();
    f.deps.cache = { get: async () => { throw new Error('offline'); }, set: async () => { throw new Error('offline'); } };
    assert.deepEqual(await createDblpSearch(f.deps)('alice'), [{ pid: '1' }]);
});
