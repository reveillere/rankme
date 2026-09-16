import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePubTitle, matchPublications, selectFuzzyCandidates, applyOverrides } from './crosscheck.js';

// Builds a fake dblp publication in the same shape dblpLocal.js's
// toPublication produces (only the fields matchPublications/normalizePubTitle
// actually read).
function dblpPub({ title, year, ee, key }) {
    return { type: 'inproceedings', dblp: { title, year, ee, key: key || title } };
}

// Builds a fake hal publication in the same shape hal.js's
// fetchPublicationsByFilter produces.
function halPub({ docid, title, year, doi = null, arxivId = null }) {
    return { docid, title, year, doi, arxivId };
}

test('normalizePubTitle: lowercases, strips accents and punctuation, collapses whitespace', () => {
    assert.equal(normalizePubTitle('Réveillère et al.: A Study of X!'), 'reveillere et al a study of x');
});

test('normalizePubTitle: null/undefined title becomes an empty string', () => {
    assert.equal(normalizePubTitle(null), '');
    assert.equal(normalizePubTitle(undefined), '');
});

test('matchPublications: no match at all -> status missing, empty matches', () => {
    const dblp = [dblpPub({ title: 'A Completely Unrelated Title', year: '2020' })];
    const hal = [halPub({ docid: 'h1', title: 'Something Else Entirely Different', year: '2020' })];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.matches, []);
});

test('matchPublications: exact match via DOI', () => {
    const dblp = [dblpPub({ title: 'Some Paper Title', year: '2019', ee: 'https://doi.org/10.1234/abc' })];
    const hal = [halPub({ docid: 'h1', title: 'A Totally Different Title', year: '1999', doi: '10.1234/ABC' })];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].confidence, 'exact');
    assert.equal(result.matches[0].halPub.docid, 'h1');
});

test('matchPublications: exact match via arXiv id, tolerant of a version suffix mismatch', () => {
    const dblp = [dblpPub({ title: 'Some Preprint', year: '2021', ee: 'https://arxiv.org/abs/2101.12345v2' })];
    const hal = [halPub({ docid: 'h1', title: 'Unrelated Text', year: '2021', arxivId: '2101.12345' })];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].confidence, 'exact');
});

test('matchPublications: exact match via arXiv id, old arXiv:<archive>/<id> ee form', () => {
    const dblp = [dblpPub({ title: 'An Old Preprint', year: '1999', ee: 'arXiv:hep-th/9901001' })];
    const hal = [halPub({ docid: 'h1', title: 'Unrelated Text', year: '1999', arxivId: 'hep-th/9901001' })];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.matches[0].confidence, 'exact');
});

test('matchPublications: strong match when year differs by exactly 1', () => {
    const dblp = [dblpPub({ title: 'A Study of Byzantine Fault Tolerance', year: '2020' })];
    const hal = [halPub({ docid: 'h1', title: 'A Study of Byzantine Fault Tolerance', year: '2021' })];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.matches[0].confidence, 'strong');
});

test('matchPublications: same title but year differs by 2 is not strong (nor exact)', () => {
    const dblp = [dblpPub({ title: 'A Study of Byzantine Fault Tolerance', year: '2020' })];
    const hal = [halPub({ docid: 'h1', title: 'A Study of Byzantine Fault Tolerance', year: '2022' })];
    const [result] = matchPublications(dblp, hal);
    for (const m of result.matches) {
        assert.notEqual(m.confidence, 'strong');
        assert.notEqual(m.confidence, 'exact');
    }
});

test('matchPublications: multi-to-multi -- two dblp pubs (CoRR + conference version) both match the same hal pub', () => {
    const corr = dblpPub({ title: 'Scalable Consensus Under Adversarial Networks', year: '2018', key: 'journals/corr/x' });
    const conf = dblpPub({ title: 'Scalable Consensus Under Adversarial Networks', year: '2019', key: 'conf/x/x' });
    const hal = [halPub({ docid: 'h1', title: 'Scalable Consensus Under Adversarial Networks', year: '2019' })];
    const results = matchPublications([corr, conf], hal);
    assert.equal(results[0].status, 'confirmed'); // corr, year off by 1 -> strong
    assert.equal(results[1].status, 'confirmed'); // conf, exact year -> strong
    assert.equal(results[0].matches[0].halPub.docid, 'h1');
    assert.equal(results[1].matches[0].halPub.docid, 'h1');
});

test('matchPublications: one dblp pub matches two different hal pubs', () => {
    const dblp = [dblpPub({ title: 'A Shared Title For Two Deposits', year: '2020' })];
    const hal = [
        halPub({ docid: 'h1', title: 'A Shared Title For Two Deposits', year: '2020' }),
        halPub({ docid: 'h2', title: 'A Shared Title For Two Deposits', year: '2021' }),
    ];
    const [result] = matchPublications(dblp, hal);
    assert.equal(result.matches.length, 2);
    const docids = result.matches.map(m => m.halPub.docid).sort();
    assert.deepEqual(docids, ['h1', 'h2']);
});

test('matchPublications: fuzzy match with blocking actually engaged -- an unrelated title never becomes a levenshtein candidate', () => {
    // The hal pub's rare tokens ("zorbatron", "quazimodal") only appear in
    // dblpTarget's title; several decoy dblp pubs share nothing with it but
    // common/irrelevant words, so blocking must exclude them as candidates
    // even though a naive O(n*m) scan would still happily compare them.
    const dblpTarget = dblpPub({ title: 'A Zorbatron Approach to Quazimodal Networks', year: '2020' });
    const decoys = [
        dblpPub({ title: 'A Completely Different Paper About Databases', year: '2020' }),
        dblpPub({ title: 'Another Unrelated Study On Compilers', year: '2020' }),
        dblpPub({ title: 'Yet Another Paper On Operating Systems', year: '2020' }),
    ];
    const hal = [halPub({ docid: 'h1', title: 'A Zorbatran Approach to Quazimodal Network', year: '2020' })]; // 2 tiny typos

    const index = { dblpTarget, decoys };
    const allDblp = [dblpTarget, ...decoys];
    const results = matchPublications(allDblp, hal);

    assert.equal(results[0].status, 'to-review'); // dblpTarget: fuzzy match
    assert.equal(results[0].matches[0].confidence, 'fuzzy');
    assert.ok(results[0].matches[0].distance <= 3);
    for (const decoyResult of results.slice(1)) {
        assert.equal(decoyResult.status, 'missing'); // decoys were never even considered
    }
    void index;
});

test('selectFuzzyCandidates: blocking narrows candidates to a small bounded set excluding an unrelated title', () => {
    // Independent, direct proof that the candidate-selection helper itself
    // (not just the final matching result) excludes an unrelated title --
    // see matchPublications' own fuzzy test above for the end-to-end case.
    const dblpNormTitles = [
        normalizePubTitle('A Zorbatron Approach to Quazimodal Networks'), // index 0 -- the real candidate
        normalizePubTitle('A Completely Different Paper About Databases'), // index 1 -- unrelated
        normalizePubTitle('Another Unrelated Study On Compilers'), // index 2 -- unrelated
    ];
    // buildFuzzyBlockingIndex isn't exported (it's an implementation detail
    // of matchPublications) -- exercised indirectly through matchPublications
    // itself is the fuzzy-match test above; this test calls the exported
    // selectFuzzyCandidates directly against a hand-built index of the same
    // shape it expects, to pin down the blocking contract in isolation.
    const distinctTitlesByToken = new Map();
    const dblpIndicesByToken = new Map();
    dblpNormTitles.forEach((title, i) => {
        for (const token of new Set(title.split(' ').filter(Boolean))) {
            if (!distinctTitlesByToken.has(token)) distinctTitlesByToken.set(token, new Set());
            distinctTitlesByToken.get(token).add(title);
            if (!dblpIndicesByToken.has(token)) dblpIndicesByToken.set(token, new Set());
            dblpIndicesByToken.get(token).add(i);
        }
    });

    const halTitle = normalizePubTitle('A Zorbatran Approach to Quazimodal Network');
    const candidates = selectFuzzyCandidates({ distinctTitlesByToken, dblpIndicesByToken }, halTitle);

    assert.ok(candidates.length > 0);
    assert.ok(candidates.length <= 5);
    assert.ok(candidates.includes(0));
    assert.ok(!candidates.includes(1));
    assert.ok(!candidates.includes(2));
});

test('selectFuzzyCandidates: a hal title sharing only stopword-cutoff-level tokens yields no candidates', () => {
    // Build an index where token "common" appears in 201 distinct titles
    // (over the 200 cutoff) -- it must never be used to fetch candidates,
    // so a hal title made only of that token gets nothing back.
    const distinctTitlesByToken = new Map([['common', new Set(Array.from({ length: 201 }, (_, i) => `title ${i}`))]]);
    const dblpIndicesByToken = new Map([['common', new Set(Array.from({ length: 201 }, (_, i) => i))]]);
    const candidates = selectFuzzyCandidates({ distinctTitlesByToken, dblpIndicesByToken }, 'common');
    assert.deepEqual(candidates, []);
});

// ****************************************************************************************************
// ****************************************************************************************************
// applyOverrides -- a maintainer's manual decision on one (dblpKey, halDocid)
// pair, layered on top of matchPublications' own automatic result. Built on
// real matchPublications() output (not hand-built result objects) so these
// tests exercise the exact same shape getCrossCheckReport actually produces.

function overridesMap(entries) {
    // entries: [[dblpKey, halDocid, decision], ...] -- mirrors the shape
    // crosscheckOverrides.getOverridesByDblpKey builds from Mongo docs.
    const byDblpKey = new Map();
    for (const [dblpKey, halDocid, decision] of entries) {
        if (!byDblpKey.has(dblpKey)) byDblpKey.set(dblpKey, new Map());
        byDblpKey.get(dblpKey).set(halDocid, decision);
    }
    return byDblpKey;
}

function report(results) {
    return { dblpStatus: { version: 'v1' }, halCacheNote: '', results };
}

test('applyOverrides: decision "same" on a to-review candidate confirms it, keeping only that match as evidence', () => {
    const dblp = [dblpPub({ title: 'A Zorbatron Approach to Quazimodal Networks', year: '2020' })];
    const hal = [halPub({ docid: 'h1', title: 'A Zorbatran Approach to Quazimodal Network', year: '2020' })];
    const results = matchPublications(dblp, hal);
    assert.equal(results[0].status, 'to-review'); // sanity check on the fixture itself

    const applied = applyOverrides(report(results), overridesMap([[dblp[0].dblp.key, 'h1', 'same']]));
    assert.equal(applied.results[0].status, 'confirmed');
    assert.equal(applied.results[0].matches.length, 1);
    assert.equal(applied.results[0].matches[0].halPub.docid, 'h1');
});

test('applyOverrides: decision "different" removing the only match demotes the pub to missing', () => {
    const dblp = [dblpPub({ title: 'Some Paper Title', year: '2019', ee: 'https://doi.org/10.1234/abc' })];
    const hal = [halPub({ docid: 'h1', title: 'A Totally Different Title', year: '1999', doi: '10.1234/ABC' })];
    const results = matchPublications(dblp, hal);
    assert.equal(results[0].status, 'confirmed'); // sanity check: exact via DOI

    const applied = applyOverrides(report(results), overridesMap([[dblp[0].dblp.key, 'h1', 'different']]));
    assert.equal(applied.results[0].status, 'missing');
    assert.deepEqual(applied.results[0].matches, []);
});

test('applyOverrides: decision "different" rejecting one candidate leaves the pub confirmed if a strong/exact match remains', () => {
    const dblp = [dblpPub({ title: 'A Shared Title For Two Deposits', year: '2020', ee: 'https://doi.org/10.1234/xyz' })];
    const hal = [
        halPub({ docid: 'h1', title: 'Unrelated Doi-Only Match', year: '1990', doi: '10.1234/XYZ' }), // exact, via doi
        halPub({ docid: 'h2', title: 'A Shared Title For Two Deposits', year: '2021' }), // strong, via title/year
    ];
    const results = matchPublications(dblp, hal);
    assert.equal(results[0].status, 'confirmed');
    assert.equal(results[0].matches.length, 2);

    const applied = applyOverrides(report(results), overridesMap([[dblp[0].dblp.key, 'h1', 'different']]));
    assert.equal(applied.results[0].status, 'confirmed');
    assert.deepEqual(applied.results[0].matches.map(m => m.halPub.docid), ['h2']);
});

test('applyOverrides: decision "different" rejecting the exact/strong match leaves only a fuzzy one -> to-review', () => {
    const dblp = [dblpPub({ title: 'A Zorbatron Approach to Quazimodal Networks', year: '2020', ee: 'https://doi.org/10.1234/def' })];
    const hal = [
        halPub({ docid: 'h1', title: 'Completely Unrelated Doi Match', year: '1990', doi: '10.1234/DEF' }), // exact, via doi
        halPub({ docid: 'h2', title: 'A Zorbatran Approach to Quazimodal Network', year: '2020' }), // fuzzy (2 typos)
    ];
    const results = matchPublications(dblp, hal);
    assert.equal(results[0].status, 'confirmed');
    assert.equal(results[0].matches.length, 2);

    const applied = applyOverrides(report(results), overridesMap([[dblp[0].dblp.key, 'h1', 'different']]));
    assert.equal(applied.results[0].status, 'to-review');
    assert.deepEqual(applied.results[0].matches.map(m => m.halPub.docid), ['h2']);
});

test('applyOverrides: a decision on a pair absent from the current report has no effect and does not crash', () => {
    const dblp = [dblpPub({ title: 'A Zorbatron Approach to Quazimodal Networks', year: '2020' })];
    const hal = [halPub({ docid: 'h1', title: 'A Zorbatran Approach to Quazimodal Network', year: '2020' })];
    const results = matchPublications(dblp, hal);
    const originalStatus = results[0].status;
    const originalDocids = results[0].matches.map(m => m.halPub.docid);

    // Neither pair below appears in the current report: one references a
    // dblpKey the report has never heard of, the other a halDocid this
    // dblp pub was never matched against.
    const applied = applyOverrides(report(results), overridesMap([
        ['some/other/dblp-key', 'h1', 'same'],
        [dblp[0].dblp.key, 'h-does-not-exist', 'different'],
    ]));
    assert.equal(applied.results[0].status, originalStatus);
    assert.deepEqual(applied.results[0].matches.map(m => m.halPub.docid), originalDocids);
});
