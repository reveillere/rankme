import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, normalizeTitle } from './levenshtein.js';

test('levenshtein: identical strings have distance 0', () => {
  assert.equal(levenshtein('acmmm', 'acmmm'), 0);
});

test('levenshtein: counts single-character edits', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('normalizeTitle: drops stopwords, numbers, and generic org names', () => {
  assert.deepEqual(
    normalizeTitle('Proceedings of the 25th ACM International Conference on Multimedia'),
    ['conference', 'multimedia']
  );
});

test('normalizeTitle: strips parenthetical asides and punctuation', () => {
  assert.deepEqual(
    normalizeTitle('IEEE Symposium on Security and Privacy (S&P 2020)'),
    ['symposium', 'security', 'privacy']
  );
});

test('normalizeTitle: two differently-formatted names for the same venue normalize the same way', () => {
  const a = normalizeTitle('34th IEEE International Conference on Distributed Computing Systems');
  const b = normalizeTitle('IEEE Conference on Distributed Computing Systems, ICDCS 2014');
  assert.deepEqual(a, ['conference', 'distributed', 'computing', 'systems']);
  assert.deepEqual(b, ['conference', 'distributed', 'computing', 'systems', 'icdcs']);
  // a is a strict prefix of b once normalized — the extra token (the
  // acronym) is exactly what pushes the levenshtein distance up rather than
  // matching perfectly, which is the situation computeRank2 is built around.
  assert.ok(levenshtein(a.join(' '), b.join(' ')) > 0);
});
