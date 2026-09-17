import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterResultsByYear, applyCorrectionsToResults, renderCrossCheckExport, renderCrossCheckExportByMember, crossCheckPresentationOptionsFrom } from './crosscheckPresentation.js';

function result({ status = 'missing', year = 2024, key = `k${year}${Math.random()}`, rank, matches = [] }) {
    return {
        status,
        publication: { type: 'inproceedings', dblp: { key, year: String(year), title: `Paper ${key}`, ee: [] }, venue: 'Some Venue', authors: [], rank },
        matches,
    };
}

function coreRank(overrides = {}) {
    return { value: 'B', source: 'ICORE2026', queryText: 'Some Conference', matchType: 'fuzzy', matchedId: 'core-entry-1', ...overrides };
}

const noSharedCorrections = async () => ({});

test('filterResultsByYear: keeps only results within the inclusive range', () => {
    const results = [result({ year: 2010 }), result({ year: 2015 }), result({ year: 2020 })];
    const filtered = filterResultsByYear(results, { from: 2012, to: 2018 });
    assert.deepEqual(filtered.map(r => r.publication.dblp.year), ['2015']);
});

test('filterResultsByYear: absent from/to means no filtering at all', () => {
    const results = [result({ year: 2010 }), result({ year: 2020 })];
    assert.equal(filterResultsByYear(results, {}).length, 2);
});

test('filterResultsByYear: a result with no year is never dropped', () => {
    const noYear = { status: 'missing', publication: { dblp: { key: 'k', year: null } }, matches: [] };
    assert.equal(filterResultsByYear([noYear], { from: 2012, to: 2018 }).length, 1);
});

test('applyCorrectionsToResults: attaches effectiveValue to the publication rank', async () => {
    const results = [result({ rank: coreRank() })];
    const [out] = await applyCorrectionsToResults(results, {}, { fetchSharedMap: noSharedCorrections });
    assert.equal(out.publication.rank.effectiveValue, 'B');
});

test('applyCorrectionsToResults: also attaches effectiveValue to each HAL candidate in matches', async () => {
    const halRank = { value: 'Q2', source: 'scimagojr:2024', queryText: 'Some Journal', matchType: 'fuzzy', matchedId: 'sjr-1' };
    const results = [result({
        status: 'to-review',
        rank: coreRank(),
        matches: [{ halPub: { docid: 'hal-1', title: 'X', authors: [], rank: halRank }, distance: 1 }],
    })];
    const [out] = await applyCorrectionsToResults(results, {}, { fetchSharedMap: noSharedCorrections });
    assert.equal(out.matches[0].halPub.rank.effectiveValue, 'Q2');
    // The publication's own rank is untouched by this.
    assert.equal(out.publication.rank.effectiveValue, 'B');
});

test('applyCorrectionsToResults: a personal override wins over a community correction, same as recordPresentation.js', async () => {
    const rank = coreRank();
    const results = [result({ rank })];
    const matchOverridesText = JSON.stringify([{ portal: 'core', rankSource: rank.source, queryText: rank.queryText, candidate: { value: 'A' } }]);
    const fetchSharedMap = async () => ({ [rank.queryText]: { candidate: { value: 'C' } } });
    const [out] = await applyCorrectionsToResults(results, { matchOverridesText }, { fetchSharedMap });
    assert.equal(out.publication.rank.effectiveValue, 'A');
});

test('applyCorrectionsToResults: useCommunityCorrections=false never calls fetchSharedMap', async () => {
    const results = [result({ rank: coreRank() })];
    let called = false;
    const fetchSharedMap = async () => { called = true; return {}; };
    await applyCorrectionsToResults(results, { useCommunityCorrections: false }, { fetchSharedMap });
    assert.equal(called, false);
});

test('renderCrossCheckExport: csv/json/md all render missing and to-review sections', () => {
    const results = [
        result({ status: 'missing', rank: coreRank() }),
        result({ status: 'to-review', rank: coreRank(), matches: [{ halPub: { docid: 'd1', title: 'Candidate', authors: [] }, distance: 1 }] }),
    ];
    const csv = renderCrossCheckExport('csv', results, 'Title');
    assert.equal(csv.contentType, 'text/csv; charset=utf-8');
    assert.match(csv.body, /^status,title,year,venue,type,dblpKey,halCandidates/);

    const json = renderCrossCheckExport('json', results, 'Title');
    const parsed = JSON.parse(json.body);
    assert.equal(parsed.missing.length, 1);
    assert.equal(parsed.toReview.length, 1);

    const md = renderCrossCheckExport('md', results, 'Title');
    assert.match(md.body, /^# Title/);
    assert.match(md.body, /Missing from HAL \(1\)/);
    assert.match(md.body, /To review \(1\)/);
});

test('crossCheckPresentationOptionsFrom: reads from the request body first, matching openapi.js\'s crossCheckOptions (body properties, not query params)', () => {
    const req = { body: { from: 2015, to: 2024, export: 'csv', matchOverrides: '[]', customRankings: '{}', useCommunityCorrections: false }, query: {} };
    const options = crossCheckPresentationOptionsFrom(req);
    assert.deepEqual(options, {
        from: 2015, to: 2024, export: 'csv', useCommunityCorrections: false, matchOverridesText: '[]', customRankingsText: '{}',
    });
});

test('crossCheckPresentationOptionsFrom: falls back to the query string when the body has nothing, same as identityLinks elsewhere in this file', () => {
    const req = { body: {}, query: { from: '2015', to: '2024' } };
    const options = crossCheckPresentationOptionsFrom(req);
    assert.equal(options.from, 2015);
    assert.equal(options.to, 2024);
    assert.equal(options.useCommunityCorrections, true); // default
});

test('renderCrossCheckExportByMember: groups results per member across csv/json/md', () => {
    const members = [
        { idHal: 'h1', name: 'Alice', pid: '1/1', results: [result({ status: 'missing' })] },
        { idHal: 'h2', name: 'Bob', pid: '2/2', results: [result({ status: 'to-review', matches: [{ halPub: { docid: 'd', title: 'C', authors: [] }, distance: 0 }] })] },
    ];
    const memberLabel = m => `${m.name} (${m.idHal})`;

    const csv = renderCrossCheckExportByMember('csv', members, 'Title', memberLabel);
    assert.match(csv.body, /^member,status,title,year,venue,type,dblpKey,halCandidates/);
    assert.match(csv.body, /Alice \(h1\)/);
    assert.match(csv.body, /Bob \(h2\)/);

    const json = renderCrossCheckExportByMember('json', members, 'Title', memberLabel);
    const parsed = JSON.parse(json.body);
    assert.equal(parsed.members.length, 2);
    assert.equal(parsed.members[0].member, 'Alice (h1)');

    const md = renderCrossCheckExportByMember('md', members, 'Title', memberLabel);
    assert.match(md.body, /## Alice \(h1\)/);
    assert.match(md.body, /## Bob \(h2\)/);
});
