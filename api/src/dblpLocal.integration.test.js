import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getClient } from './db.js';
import * as dblpLocal from './dblpLocal.js';

// Runs against a real MongoDB (MONGO_URI), to catch driver upgrades that
// change query behavior. Skipped when MONGO_URI is unset (plain `npm test`).
// Only touches records under the zz-it/ pid prefix and the zz-it/ keys it
// inserts itself, so it is safe to point at a dev database with real data.
const skip = !process.env.MONGO_URI && 'MONGO_URI not set';

const PID = 'zz-it/0001';
const COAUTHOR_PID = 'zz-it/0002';
const NAME = 'Zélie Integration';
const COAUTHOR = 'Zack Coauthor-It';

const www = [
    { _id: `homepages/${PID}`, key: `homepages/${PID}`, author: [NAME, 'Z. Integration'], url: ['https://orcid.org/0000-0002-1825-0097'],
      authorTokens: [...new Set([NAME, 'Z. Integration'].flatMap(dblpLocal.tokenizeName))] },
    { _id: `homepages/${COAUTHOR_PID}`, key: `homepages/${COAUTHOR_PID}`, author: COAUTHOR,
      authorTokens: dblpLocal.tokenizeName(COAUTHOR) },
];
const inproceedings = [
    { _id: 'zz-it/conf/1', key: 'zz-it/conf/1', author: [NAME, COAUTHOR], title: 'A Conference Paper.', booktitle: 'ICSE', year: '2024', ee: 'https://doi.org/10.1/zz1' },
];
const article = [
    { _id: 'zz-it/journal/1', key: 'zz-it/journal/1', author: 'Z. Integration', title: 'A Journal Paper.', journal: 'IEEE Trans. Software Eng.', year: '2022' },
    { _id: 'zz-it/corr/1', key: 'zz-it/corr/1', author: NAME, title: 'A Preprint.', journal: 'CoRR', year: '2023' },
];

async function collections() {
    const db = (await getClient()).db('dblp');
    return { www: db.collection('www'), inproceedings: db.collection('inproceedings'), article: db.collection('article') };
}

async function cleanup() {
    const c = await collections();
    for (const coll of Object.values(c)) await coll.deleteMany({ _id: { $regex: '^(homepages/)?zz-it/' } });
}

before(async () => {
    if (skip) return;
    await cleanup();
    const c = await collections();
    await c.www.insertMany(www);
    await c.inproceedings.insertMany(inproceedings);
    await c.article.insertMany(article);
});

after(async () => {
    if (skip) return;
    await cleanup();
    await (await getClient()).close();
});

test('searchAuthorsByName matches every query word as a prefix, accent-insensitively', { skip }, async () => {
    const results = await dblpLocal.searchAuthorsByName('zelie integ');
    assert.deepEqual(results.filter(r => r.pid.startsWith('zz-it/')), [{ author: NAME, pid: PID, affiliation: [] }]);
    assert.deepEqual((await dblpLocal.searchAuthorsByName('zelie nomatch')).filter(r => r.pid.startsWith('zz-it/')), []);
});

test('getAuthorNames returns every name variant, or null for an unknown pid', { skip }, async () => {
    assert.deepEqual(await dblpLocal.getAuthorNames(PID), [NAME, 'Z. Integration']);
    assert.equal(await dblpLocal.getAuthorNames('zz-it/9999'), null);
});

test('getAuthorOrcid and findAuthorByOrcid read the ORCID from the homepage urls', { skip }, async () => {
    assert.equal(await dblpLocal.getAuthorOrcid(PID), '0000-0002-1825-0097');
    assert.deepEqual(await dblpLocal.findAuthorByOrcid('0000-0002-1825-0097'), { pid: PID, name: NAME });
});

test('getPublicationsByNames finds papers under any name variant, newest first, with co-author pids', { skip }, async () => {
    const pubs = await dblpLocal.getPublicationsByNames([NAME, 'Z. Integration']);
    assert.deepEqual(pubs.map(p => [p.type, p.dblp.year, p.venue]), [
        ['inproceedings', '2024', 'ICSE'],
        ['informal', '2023', 'CoRR'],
        ['article', '2022', 'IEEE Trans. Software Eng.'],
    ]);
    const conf = pubs[0];
    assert.deepEqual(conf.authors, [
        { $: { pid: PID }, _: NAME },
        { $: { pid: COAUTHOR_PID }, _: COAUTHOR },
    ]);
    assert.equal(conf.dblp.title, 'A Conference Paper.');
});

test('getAuthorNamesByPids batches the lookup and leaves unknown pids out', { skip }, async () => {
    const map = await dblpLocal.getAuthorNamesByPids([PID, COAUTHOR_PID, 'zz-it/9999']);
    assert.deepEqual(Object.fromEntries(map), { [PID]: [NAME, 'Z. Integration'], [COAUTHOR_PID]: [COAUTHOR] });
});
