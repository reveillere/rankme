import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getClient } from './db.js';
import { countMatching, findMatching } from './admin.js';

// Regression test for the Nov 2026 DBLP update: an incremental run touched
// ~530k articles, and a single `{ _id: { $in: ids } }` over all of them is
// a >16 MB BSON document Mongo rejects. Uses its own throwaway collection.
const skip = !process.env.MONGO_URI && 'MONGO_URI not set';
const COLL = 'zz_it_chunks';

const realIds = Array.from({ length: 300 }, (_, i) => `journals/zz-it/Paper${String(i).padStart(6, '0')}`);
// 600k ids at ~36 bytes each: ~25 MB as one $in, well over the limit.
const ids = [...realIds, ...Array.from({ length: 600000 }, (_, i) => `journals/zz-it/Missing${String(i).padStart(7, '0')}`)];

async function coll() {
    return (await getClient()).db('dblp').collection(COLL);
}

before(async () => {
    if (skip) return;
    const c = await coll();
    await c.deleteMany({});
    await c.insertMany(realIds.map((_id) => ({ _id, key: _id })));
});

after(async () => {
    if (skip) return;
    await (await coll()).drop().catch(() => {});
});

test('a single $in over that many ids is indeed rejected by Mongo', { skip }, async () => {
    await assert.rejects((await coll()).countDocuments({ _id: { $in: ids } }));
});

test('countMatching and findMatching work in chunks over the same ids', { skip }, async () => {
    const c = await coll();
    assert.equal(await countMatching(c, {}, ids), realIds.length);
    const seen = [];
    for await (const doc of findMatching(c, {}, ids, { projection: { _id: 1 } })) seen.push(doc._id);
    assert.deepEqual(seen.sort(), [...realIds].sort());
});

test('without ids they scan the whole base filter', { skip }, async () => {
    const c = await coll();
    assert.equal(await countMatching(c, { key: { $regex: '^journals/zz-it/Paper00000' } }, null), 10);
    let n = 0;
    for await (const _ of findMatching(c, {}, null)) n++;
    assert.equal(n, realIds.length);
});
