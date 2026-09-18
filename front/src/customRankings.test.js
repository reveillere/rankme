import { describe, it, expect, vi } from 'vitest';
import { resolveProfile, resolveEffectiveCustomValue, resolveDisplayValue, parseProfilesJSON, entryKeyFor } from './customRankings';

const rank = { source: 'ICORE2026', queryText: 'International Conference on Testing', matchedId: 'core-id-1', value: 'B' };

it('deletes all custom profiles in one update and keeps other personal data', async () => {
  const saved = new Map([
    ['rankme:customRankings', JSON.stringify({ p1: profileWith({ venue: { byEdition: { ALL: 'A' } } }), p2: { ...profileWith({}), id: 'p2' } })],
    ['rankme:identityLinks', 'keep'],
  ]);
  const changed = vi.fn();
  const events = new EventTarget();
  events.addEventListener('rankme:customrankingchange', changed);
  vi.stubGlobal('window', events);
  vi.stubGlobal('localStorage', { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) });
  try {
    vi.resetModules();
    const { listProfiles, getProfile, deleteAllProfiles } = await import('./customRankings');
    expect(listProfiles()).toHaveLength(2);
    deleteAllProfiles();
    expect(listProfiles()).toEqual([]);
    expect(getProfile('p1')).toBeNull();
    expect(saved.get('rankme:customRankings')).toBe('{}');
    expect(saved.get('rankme:identityLinks')).toBe('keep');
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

function profileWith(entries) {
  return { id: 'p1', name: 'My ranking', reference: 'core', entries };
}

describe('resolveProfile', () => {
  it('finds a profile by id, null for an unknown or missing id', () => {
    const profiles = { p1: profileWith({}) };
    expect(resolveProfile(profiles, 'p1').name).toBe('My ranking');
    expect(resolveProfile(profiles, 'nope')).toBeNull();
    expect(resolveProfile(profiles, null)).toBeNull();
  });
});

describe('resolveEffectiveCustomValue', () => {
  it('falls back to the automatic rank value when there is no profile or no matching entry', () => {
    expect(resolveEffectiveCustomValue({}, 'missing', 'core', rank, null, 2024)).toEqual({ value: 'B', hasEntry: false });
    const profiles = { p1: profileWith({}) };
    expect(resolveEffectiveCustomValue(profiles, 'p1', 'core', rank, null, 2024)).toEqual({ value: 'B', hasEntry: false });
  });

  it('a specific-year entry wins over an ALL entry', () => {
    const key = entryKeyFor('core', rank, null);
    const profiles = { p1: profileWith({ [key]: { byEdition: { 2024: 'A', ALL: 'C' } } }) };
    expect(resolveEffectiveCustomValue(profiles, 'p1', 'core', rank, null, 2024)).toEqual({ value: 'A', hasEntry: true });
  });

  it('falls back to the ALL entry when there is no entry for that specific year', () => {
    const key = entryKeyFor('core', rank, null);
    const profiles = { p1: profileWith({ [key]: { byEdition: { ALL: 'C' } } }) };
    expect(resolveEffectiveCustomValue(profiles, 'p1', 'core', rank, null, 2024)).toEqual({ value: 'C', hasEntry: true });
  });
});

describe('resolveDisplayValue', () => {
  it('with no custom profile selected, delegates to the plain automatic/override resolution', () => {
    const overrides = { 'core:ICORE2026:International Conference on Testing': { candidate: { value: 'A' } } };
    expect(resolveDisplayValue(overrides, {}, rank, { portal: 'core' })).toBe('A');
  });

  it('with a custom profile selected, uses the profile entry instead', () => {
    const key = entryKeyFor('core', rank, null);
    const profiles = { p1: profileWith({ [key]: { byEdition: { ALL: 'A*' } } }) };
    expect(resolveDisplayValue({}, profiles, rank, { portal: 'core', customProfileId: 'p1', year: 2024 })).toBe('A*');
  });

  it('returns undefined for a missing rank rather than throwing', () => {
    expect(resolveDisplayValue({}, {}, null, {})).toBeUndefined();
  });
});

describe('parseProfilesJSON', () => {
  it('accepts a single profile object or an array of them, keyed by id', () => {
    const single = parseProfilesJSON(JSON.stringify(profileWith({})));
    expect(Object.keys(single)).toEqual(['p1']);

    const many = parseProfilesJSON(JSON.stringify([profileWith({}), { ...profileWith({}), id: 'p2' }]));
    expect(Object.keys(many).sort()).toEqual(['p1', 'p2']);
  });

  it('defaults a missing entries object to {} rather than crashing later lookups', () => {
    const parsed = parseProfilesJSON(JSON.stringify({ id: 'p1', reference: 'core' }));
    expect(parsed.p1.entries).toEqual({});
  });

  it('skips a profile with no id or an invalid reference', () => {
    const parsed = parseProfilesJSON(JSON.stringify([{ id: 'p1', reference: 'not-a-real-reference' }, { reference: 'core' }]));
    expect(parsed).toEqual({});
  });
});
