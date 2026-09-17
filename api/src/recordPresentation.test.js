import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecords, sortRecords, presentationOptionsFrom, renderExport } from './recordPresentation.js';

function dblpPub({ year, type = 'inproceedings', rank, key = `k${year}${Math.random()}` }) {
    return { type, dblp: { key, year: String(year), title: `Paper ${key}`, ee: [] }, venue: 'Some Venue', authors: [], rank };
}

function halPub({ year, type = 'COMM', rank, docid = `d${year}${Math.random()}` }) {
    return { type, docid, year, title: `Paper ${docid}`, venue: 'Some Venue', authors: [] };
}

test('filterRecords: from/to keeps only years within the inclusive range', () => {
    const records = [dblpPub({ year: 2010 }), dblpPub({ year: 2015 }), dblpPub({ year: 2020 })];
    const result = filterRecords(records, 'dblp', { from: 2012, to: 2018, categories: null, ranks: null });
    assert.deepEqual(result.map(r => r.dblp.year), ['2015']);
});

test('filterRecords: a record with no year is never dropped by from/to', () => {
    const noYear = { type: 'inproceedings', dblp: { key: 'k', year: null } };
    const result = filterRecords([noYear], 'dblp', { from: 2012, to: 2018, categories: null, ranks: null });
    assert.equal(result.length, 1);
});

test('filterRecords: categories restricts to the given dblp types', () => {
    const records = [dblpPub({ year: 2020, type: 'inproceedings' }), dblpPub({ year: 2020, type: 'article' })];
    const result = filterRecords(records, 'dblp', { from: null, to: null, categories: ['article'], ranks: null });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'article');
});

test('filterRecords: categories maps HAL type codes to the shared vocabulary', () => {
    const records = [halPub({ year: 2020, type: 'COMM' }), halPub({ year: 2020, type: 'OUV' })];
    const result = filterRecords(records, 'hal', { from: null, to: null, categories: ['inproceedings'], ranks: null });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'COMM');
});

test('filterRecords: ranks restricts by computed rank value, unranked records always pass through', () => {
    const records = [
        dblpPub({ year: 2020, rank: { value: 'A' } }),
        dblpPub({ year: 2020, rank: { value: 'B' } }),
        dblpPub({ year: 2020, rank: undefined }),
    ];
    const result = filterRecords(records, 'dblp', { from: null, to: null, categories: null, ranks: ['A'] });
    assert.equal(result.length, 2); // the 'A' one, plus the unranked one
    assert.ok(result.some(r => r.rank === undefined));
    assert.ok(result.some(r => r.rank?.value === 'A'));
});

test('sortRecords: "date" orders most recent first', () => {
    const records = [dblpPub({ year: 2010 }), dblpPub({ year: 2020 }), dblpPub({ year: 2015 })];
    const result = sortRecords(records, 'dblp', 'date');
    assert.deepEqual(result.map(r => r.dblp.year), ['2020', '2015', '2010']);
});

test('sortRecords: "date-rank" groups by year, best rank first within a year', () => {
    const records = [
        dblpPub({ year: 2020, rank: { value: 'B' }, key: 'b' }),
        dblpPub({ year: 2020, rank: { value: 'A' }, key: 'a' }),
        dblpPub({ year: 2019, rank: { value: 'C' }, key: 'c' }),
    ];
    const result = sortRecords(records, 'dblp', 'date-rank');
    assert.deepEqual(result.map(r => r.dblp.key), ['a', 'b', 'c']);
});

test('sortRecords: "rank-date" groups by rank tier, most recent first within a tier', () => {
    const records = [
        dblpPub({ year: 2018, rank: { value: 'A' }, key: 'old-a' }),
        dblpPub({ year: 2020, rank: { value: 'B' }, key: 'new-b' }),
        dblpPub({ year: 2021, rank: { value: 'A' }, key: 'new-a' }),
    ];
    const result = sortRecords(records, 'dblp', 'rank-date');
    assert.deepEqual(result.map(r => r.dblp.key), ['new-a', 'old-a', 'new-b']);
});

test('presentationOptionsFrom: parses comma-separated categories/ranks and validates enums', () => {
    const req = { query: { from: '2015', to: '2020', categories: 'article,inproceedings', ranks: 'A,B', sort: 'rank-date', export: 'csv' } };
    assert.deepEqual(presentationOptionsFrom(req), {
        from: 2015, to: 2020, categories: ['article', 'inproceedings'], ranks: ['A', 'B'], sort: 'rank-date', export: 'csv',
    });
});

test('presentationOptionsFrom: invalid/absent values fall back to safe defaults, never throw', () => {
    const req = { query: { from: 'not-a-year', sort: 'nonsense', export: 'exe' } };
    const options = presentationOptionsFrom(req);
    assert.equal(options.from, null);
    assert.equal(options.sort, 'date');
    assert.equal(options.export, null);
    assert.equal(options.categories, null);
});

test('renderExport: csv includes a header row and escapes embedded commas/quotes', () => {
    const records = [dblpPub({ year: 2020, rank: { value: 'A' }, key: 'k1' })];
    records[0].dblp.title = 'A title, with a comma';
    const { contentType, body } = renderExport('csv', records, 'dblp', 'Title');
    assert.equal(contentType, 'text/csv; charset=utf-8');
    assert.match(body, /^year,rank,authors,title,venue,type,doi/);
    assert.match(body, /"A title, with a comma"/);
});

test('renderExport: json produces a flattened publications array, not the raw record shape', () => {
    const records = [dblpPub({ year: 2020, rank: { value: 'A' }, key: 'k1' })];
    const { contentType, body } = renderExport('json', records, 'dblp', 'My Title');
    assert.equal(contentType, 'application/json; charset=utf-8');
    const parsed = JSON.parse(body);
    assert.equal(parsed.title, 'My Title');
    assert.deepEqual(Object.keys(parsed.publications[0]).sort(), ['authors', 'doi', 'rank', 'title', 'type', 'venue', 'year'].sort());
});

test('renderExport: markdown lists each record with its rank and escapes markdown-significant characters', () => {
    const records = [dblpPub({ year: 2020, rank: { value: 'A' }, key: 'k1' })];
    records[0].dblp.title = 'Title with [brackets] and *stars*';
    const { contentType, body } = renderExport('md', records, 'dblp', 'My Title');
    assert.equal(contentType, 'text/markdown; charset=utf-8');
    assert.match(body, /^# My Title/);
    assert.match(body, /\*\*\[A\]\*\*/);
    assert.match(body, /\\\[brackets\\\]/);
});
