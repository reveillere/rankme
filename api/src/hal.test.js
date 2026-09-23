import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthorSearchDocs, parseAuthors, structureMembersOf } from './hal.js';

test('normalizeAuthorSearchDocs: a bare duplicate (no idHal_s) of the same form is dropped in favor of the preferred entry', () => {
    const docs = [
        { fullName_s: 'Leo Mendiboure', form_i: '1788332' }, // INCOMING duplicate, no idHal_s
        { fullName_s: 'Leo Mendiboure', form_i: '1788332', idHal_s: 'leo-mendiboure' }, // PREFERRED
    ];
    const result = normalizeAuthorSearchDocs(docs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'leo-mendiboure');
});

test('normalizeAuthorSearchDocs: two distinct forms sharing the same idHal_s (HAL admin merge) collapse into one result', () => {
    const docs = [
        { fullName_s: 'Léo Mendiboure', form_i: '1799832', idHal_s: 'leo-mendiboure' },
        { fullName_s: 'Leo Mendiboure', form_i: '1788332', idHal_s: 'leo-mendiboure' },
    ];
    const result = normalizeAuthorSearchDocs(docs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'leo-mendiboure');
});

test('normalizeAuthorSearchDocs: a form with no idHal_s at all keeps its own form_i as id', () => {
    const docs = [{ fullName_s: 'Unclaimed Author', form_i: '42' }];
    const result = normalizeAuthorSearchDocs(docs);
    assert.deepEqual(result, [{ author: 'Unclaimed Author', id: 'form:42', affiliation: [] }]);
});

test('normalizeAuthorSearchDocs: a doc with no fullName_s is skipped entirely', () => {
    const docs = [{ form_i: '1', idHal_s: 'someone' }, { fullName_s: 'Real Author', form_i: '2', idHal_s: 'real-author' }];
    const result = normalizeAuthorSearchDocs(docs);
    assert.equal(result.length, 1);
    assert.equal(result[0].author, 'Real Author');
});

test('normalizeAuthorSearchDocs: affiliation carries emailDomain_s through, defaulting to an empty array', () => {
    const docs = [{ fullName_s: 'A', form_i: '1', idHal_s: 'a', emailDomain_s: ['labri.fr'] }];
    const result = normalizeAuthorSearchDocs(docs);
    assert.deepEqual(result[0].affiliation, ['labri.fr']);
});

test('parseAuthors: reads idHal + name off the authIdHalFullName_fs facet', () => {
    const doc = { authIdHalFullName_fs: ['laurent-reveillere_FacetSep_Laurent Réveillère'] };
    assert.deepEqual(parseAuthors(doc), [{ name: 'Laurent Réveillère', idHal: 'laurent-reveillere', form: null }]);
});

test('parseAuthors: a facet with no separator is just a name, no idHal', () => {
    const doc = { authIdHalFullName_fs: ['Some Unclaimed Author'] };
    assert.deepEqual(parseAuthors(doc), [{ name: 'Some Unclaimed Author', idHal: null, form: null }]);
});

test('parseAuthors: pairs authIdFormPerson_s by index to attach form_i to each author', () => {
    const doc = {
        authIdHalFullName_fs: ['laurent-reveillere_FacetSep_Laurent Réveillère', '_FacetSep_Some Unclaimed Author'],
        authIdFormPerson_s: ['12345', '641102'],
    };
    assert.deepEqual(parseAuthors(doc), [
        { name: 'Laurent Réveillère', idHal: 'laurent-reveillere', form: '12345' },
        { name: 'Some Unclaimed Author', idHal: null, form: '641102' },
    ]);
});

test('parseAuthors: falls back to authFullName_s when there is no facet field at all', () => {
    const doc = { authFullName_s: ['Alice', 'Bob'] };
    assert.deepEqual(parseAuthors(doc), [{ name: 'Alice', idHal: null, form: null }, { name: 'Bob', idHal: null, form: null }]);
});

test('parseAuthors: no author fields at all yields an empty list, not a crash', () => {
    assert.deepEqual(parseAuthors({}), []);
});

test('structureMembersOf: returns the idHal of every member affiliated with the target structure', () => {
    const doc = {
        authIdHasStructure_fs: [
            'formA_FacetSep_LabelA_JoinSep_3102_FacetSep_LabA',
            'formB_FacetSep_LabelB_JoinSep_9999_FacetSep_LabB', // a different structure
        ],
        authIdFormPerson_s: ['formA', 'formB', 'formC'],
        authIdHalFullName_fs: ['alice_FacetSep_Alice A.', 'bob_FacetSep_Bob B.', 'carol_FacetSep_Carol C.'],
    };
    assert.deepEqual(structureMembersOf(doc, '3102'), ['alice']);
});

test('structureMembersOf: structId is compared as a string, so a numeric id still matches', () => {
    const doc = {
        authIdHasStructure_fs: ['formA_FacetSep_LabelA_JoinSep_3102_FacetSep_LabA'],
        authIdFormPerson_s: ['formA'],
        authIdHalFullName_fs: ['alice_FacetSep_Alice A.'],
    };
    assert.deepEqual(structureMembersOf(doc, 3102), ['alice']);
});

test('structureMembersOf: an affiliated member with no claimed HAL account (empty idHal facet) is excluded', () => {
    const doc = {
        authIdHasStructure_fs: ['formA_FacetSep_LabelA_JoinSep_3102_FacetSep_LabA'],
        authIdFormPerson_s: ['formA'],
        authIdHalFullName_fs: [''],
    };
    assert.deepEqual(structureMembersOf(doc, '3102'), []);
});

test('structureMembersOf: no affiliation facets at all yields an empty list', () => {
    assert.deepEqual(structureMembersOf({}, '3102'), []);
});
