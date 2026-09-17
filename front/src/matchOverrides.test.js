import { describe, it, expect } from 'vitest';
import { resolveOverride, resolveEffectiveValue, portalFromRank, parseOverridesJSON } from './matchOverrides';

const rank = { source: 'core:2024', queryText: 'International Conference on Testing', value: 'B', matchType: 'fuzzy' };

describe('resolveOverride', () => {
  it('finds an override keyed on (portal, rank.source, rank.queryText)', () => {
    const overrides = { 'core:core:2024:International Conference on Testing': { candidate: { value: 'A' } } };
    const found = resolveOverride(overrides, 'core', rank);
    expect(found.candidate.value).toBe('A');
  });

  it('returns null for a rank with no source/queryText, without throwing', () => {
    expect(resolveOverride({}, 'core', {})).toBeNull();
  });

  it('returns null when nothing matches the key', () => {
    expect(resolveOverride({}, 'core', rank)).toBeNull();
  });
});

describe('portalFromRank', () => {
  it('recognizes CCF and SJR by their source prefix, defaults to core otherwise', () => {
    expect(portalFromRank({ source: 'CCF2026' })).toBe('ccf');
    expect(portalFromRank({ source: 'scimagojr:2024' })).toBe('sjr');
    expect(portalFromRank({ source: 'ICORE2026' })).toBe('core');
  });
});

describe('resolveEffectiveValue', () => {
  it('a personal override wins over the automatic value', () => {
    const overrides = { 'core:core:2024:International Conference on Testing': { candidate: { value: 'A' } } };
    expect(resolveEffectiveValue(overrides, rank, null)).toBe('A');
  });

  it('a shared/community correction is used when there is no personal override', () => {
    const sharedMap = { 'International Conference on Testing': { candidate: { value: 'C' } } };
    expect(resolveEffectiveValue({}, rank, sharedMap)).toBe('C');
  });

  it('falls back to the plain automatic rank value when there is neither', () => {
    expect(resolveEffectiveValue({}, rank, null)).toBe('B');
  });

  it('a personal override still wins over a shared correction', () => {
    const overrides = { 'core:core:2024:International Conference on Testing': { candidate: { value: 'A' } } };
    const sharedMap = { 'International Conference on Testing': { candidate: { value: 'C' } } };
    expect(resolveEffectiveValue(overrides, rank, sharedMap)).toBe('A');
  });

  it('returns undefined for a missing rank rather than throwing', () => {
    expect(resolveEffectiveValue({}, null, null)).toBeUndefined();
  });
});

describe('parseOverridesJSON', () => {
  it('turns an array of entries into a {[key]: entry} map keyed the same way resolveOverride expects', () => {
    const json = JSON.stringify([
      { portal: 'core', rankSource: 'core:2024', queryText: 'International Conference on Testing', candidate: { value: 'A' } },
    ]);
    const overrides = parseOverridesJSON(json);
    expect(resolveEffectiveValue(overrides, rank, null)).toBe('A');
  });

  it('skips an entry missing a required field instead of throwing', () => {
    const json = JSON.stringify([{ portal: 'core', queryText: 'x' }]);
    expect(parseOverridesJSON(json)).toEqual({});
  });

  it('rejects a non-array payload', () => {
    expect(() => parseOverridesJSON(JSON.stringify({ not: 'an array' }))).toThrow();
  });
});
