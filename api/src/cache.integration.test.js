import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cache from './cache.js';

// Runs against a real Redis (REDIS_URI), to catch client upgrades that
// change command behavior. Skipped when REDIS_URI is unset (plain
// `npm test`). Only uses keys under zz-it:.
const skip = !process.env.REDIS_URI && 'REDIS_URI not set';
const key = (name) => `zz-it:${process.pid}:${name}`;

test('set then get round-trips JSON values', { skip }, async () => {
    await cache.set(key('obj'), { a: 1, list: ['x', 'y'], nested: { ok: true } });
    assert.deepEqual(await cache.get(key('obj')), { a: 1, list: ['x', 'y'], nested: { ok: true } });
    assert.equal(await cache.get(key('missing')), null);
});

test('set with a TTL expires the key', { skip }, async () => {
    await cache.set(key('ttl'), 'soon gone', 1);
    assert.equal(await cache.get(key('ttl')), 'soon gone');
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(await cache.get(key('ttl')), null);
});

test('mget returns only the hits, keyed by name', { skip }, async () => {
    await cache.set(key('m1'), 1);
    await cache.set(key('m2'), { two: 2 });
    const result = await cache.mget([key('m1'), key('m2'), key('m3')]);
    assert.deepEqual([...result.entries()], [[key('m1'), 1], [key('m2'), { two: 2 }]]);
    assert.equal((await cache.mget([])).size, 0);
});

test('status reports a healthy connection', { skip }, async () => {
    const status = await cache.status();
    assert.equal(status.ok, true);
    assert.equal(typeof status.dbsize, 'number');
});
