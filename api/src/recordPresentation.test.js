import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecords, sortRecords, presentationOptionsFrom, renderExport, applyCorrections, parseCustomRankingsAxes } from './recordPresentation.js';

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
        useCommunityCorrections: true, matchOverridesText: null, customRankingsText: null,
    });
});

test('presentationOptionsFrom: reads matchOverrides/customRankings as opaque JSON text, and useCommunityCorrections=false as an explicit opt-out', () => {
    const req = { query: { matchOverrides: '[{"portal":"core"}]', customRankings: '{"conference":{}}', useCommunityCorrections: 'false' } };
    const options = presentationOptionsFrom(req);
    assert.equal(options.matchOverridesText, '[{"portal":"core"}]');
    assert.equal(options.customRankingsText, '{"conference":{}}');
    assert.equal(options.useCommunityCorrections, false);
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

// ****************************************************************************************************
// applyCorrections / parseCustomRankingsAxes

function coreRank(overrides = {}) {
    return { value: 'B', source: 'ICORE2026', queryText: 'Some Conference', matchType: 'fuzzy', matchedId: 'core-entry-1', ...overrides };
}

const noSharedCorrections = async () => ({});

test('applyCorrections: no corrections supplied still attaches effectiveValue, equal to the automatic value', async () => {
    const records = [dblpPub({ year: 2024, rank: coreRank() })];
    const [result] = await applyCorrections(records, 'dblp', {}, { fetchSharedMap: noSharedCorrections });
    assert.equal(result.rank.effectiveValue, 'B');
    assert.equal(result.rank.value, 'B'); // never touched
});

test('applyCorrections: a personal override wins over a community correction', async () => {
    const rank = coreRank();
    const records = [dblpPub({ year: 2024, rank })];
    const matchOverridesText = JSON.stringify([
        { portal: 'core', rankSource: rank.source, queryText: rank.queryText, candidate: { value: 'A' } },
    ]);
    const fetchSharedMap = async () => ({ [rank.queryText]: { candidate: { value: 'C' } } });
    const [result] = await applyCorrections(records, 'dblp', { matchOverridesText }, { fetchSharedMap });
    assert.equal(result.rank.effectiveValue, 'A');
});

test('applyCorrections: a community correction applies when there is no personal override', async () => {
    const rank = coreRank();
    const records = [dblpPub({ year: 2024, rank })];
    const fetchSharedMap = async () => ({ [rank.queryText]: { candidate: { value: 'C' } } });
    const [result] = await applyCorrections(records, 'dblp', {}, { fetchSharedMap });
    assert.equal(result.rank.effectiveValue, 'C');
});

test('applyCorrections: useCommunityCorrections=false never calls fetchSharedMap and skips shared corrections', async () => {
    const rank = coreRank();
    const records = [dblpPub({ year: 2024, rank })];
    let called = false;
    const fetchSharedMap = async () => { called = true; return { [rank.queryText]: { candidate: { value: 'C' } } }; };
    const [result] = await applyCorrections(records, 'dblp', { useCommunityCorrections: false }, { fetchSharedMap });
    assert.equal(called, false);
    assert.equal(result.rank.effectiveValue, 'B'); // falls back to the automatic value
});

test('applyCorrections: community promotion works for a CCF-sourced rank too', async () => {
    const rank = { value: 'B', source: 'CCF2026', queryText: 'Some Venue', matchType: 'fuzzy' };
    const records = [dblpPub({ year: 2024, type: 'inproceedings', rank })];
    const fetchSharedMap = async (portal) => (portal === 'ccf' ? { [rank.queryText]: { candidate: { value: 'A' } } } : {});
    const [result] = await applyCorrections(records, 'dblp', {}, { fetchSharedMap });
    assert.equal(result.rank.effectiveValue, 'A');
});

test('applyCorrections: a custom ranking active on one axis never leaks onto the other', async () => {
    // customProfileIdForPortal only ever resolves 'core'->conference,
    // 'sjr'->journal -- a conference-axis profile must have no effect on a
    // journal-sourced (SJR) record even if both are present in the batch.
    const conferenceProfile = { id: 'conf-1', reference: 'core', entries: { 'core:id:core-entry-1': { byEdition: { ALL: 'A*' } } } };
    const journalRank = { value: 'Q3', source: 'scimagojr:2024', queryText: 'Some Journal', matchType: 'fuzzy', matchedId: 'sjr-entry-1' };
    const records = [
        dblpPub({ year: 2024, type: 'inproceedings', rank: coreRank() }),
        dblpPub({ year: 2024, type: 'article', rank: journalRank }),
    ];
    const customRankingsText = JSON.stringify({ conference: conferenceProfile });
    const [confResult, journalResult] = await applyCorrections(records, 'dblp', { customRankingsText }, { fetchSharedMap: noSharedCorrections });
    assert.equal(confResult.rank.effectiveValue, 'A*');
    assert.equal(journalResult.rank.effectiveValue, 'Q3'); // untouched, no journal profile supplied
});

test('parseCustomRankingsAxes: accepts a profile per axis, validated against its own reference', () => {
    const text = JSON.stringify({
        conference: { id: 'c1', reference: 'core' },
        journal: { id: 'j1', reference: 'ccf' }, // ccf covers both axes
    });
    const axes = parseCustomRankingsAxes(text);
    assert.equal(axes.conference.id, 'c1');
    assert.equal(axes.journal.id, 'j1');
});

test('parseCustomRankingsAxes: rejects a profile whose reference cannot cover the axis it is placed under', () => {
    const text = JSON.stringify({ conference: { id: 'j1', reference: 'sjr' } }); // sjr never covers conferences
    assert.throws(() => parseCustomRankingsAxes(text));
});

test('parseCustomRankingsAxes: absent axes default to null, not an error', () => {
    assert.deepEqual(parseCustomRankingsAxes('{}'), { conference: null, journal: null });
});
