import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentityLinks, IdentityLinksConflictError } from './identityLinksInput.js';

test('accepts the browser export and legacy links arrays without mutating them', () => {
  const entries = [{ idHal: 'alice', pid: '1/1' }];
  const exported = { format: 'rankme-personal-data', version: 1, kind: 'identity-links', scope: { type: 'structure', id: 'lab' }, entries };
  for (const input of [entries, exported, JSON.stringify(exported)]) {
    assert.deepEqual([...parseIdentityLinks(input).byIdHal], [['alice', '1/1']]);
  }
  assert.deepEqual(entries, [{ idHal: 'alice', pid: '1/1' }]);
});

test('rejects the wrong file type/version and contradictory identities', () => {
  const exported = { format: 'rankme-personal-data', version: 1, kind: 'identity-links', entries: [] };
  for (const invalid of [{ ...exported, kind: 'crosscheck-decisions' }, { ...exported, version: 2 }, [{ idHal: 'alice', pid: '1/1' }, { idHal: 'bob', pid: '1/1' }]]) {
    assert.throws(() => parseIdentityLinks(invalid), IdentityLinksConflictError);
  }
});
