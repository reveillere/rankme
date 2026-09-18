const FIXED_KEYS = [
  'rankme:conferenceSource',
  'rankme:journalSource',
  'rankme:filterCategories',
  'rankme:customRankings',
  'rankme:matchOverrides',
  'rankme:useCommunityOverrides',
  'rankme:identityLinks',
  'rankme:crosscheckDecisions',
];
const FILTER_RANKS_PREFIX = 'rankme:filterRanks:';

export function isPreferenceKey(key) {
  return FIXED_KEYS.includes(key) || Boolean(key?.startsWith(FILTER_RANKS_PREFIX));
}

export function preferenceKeys() {
  const keys = [...FIXED_KEYS];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(FILTER_RANKS_PREFIX)) keys.push(key);
  }
  return keys;
}

export function exportPreferences() {
  const preferences = {};
  for (const key of preferenceKeys()) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      try { preferences[key] = JSON.parse(value); } catch { preferences[key] = value; }
    }
  }
  return { format: 'rankme-preferences', version: 1, preferences };
}

export function downloadPreferences() {
  const blob = new Blob([JSON.stringify(exportPreferences(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `rankme-preferences-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function importPreferences(input) {
  if (!input || input.format !== 'rankme-preferences' || input.version !== 1 || !input.preferences || typeof input.preferences !== 'object' || Array.isArray(input.preferences)) {
    throw new Error('Expected a RankMe preferences file (version 1).');
  }
  const allowed = new Set(preferenceKeys());
  const incoming = Object.entries(input.preferences).filter(([key]) => key === 'rankme:filterCategories' || key === 'rankme:customRankings' || key === 'rankme:matchOverrides' || key === 'rankme:useCommunityOverrides' || key === 'rankme:identityLinks' || key === 'rankme:crosscheckDecisions' || key === 'rankme:conferenceSource' || key === 'rankme:journalSource' || key.startsWith(FILTER_RANKS_PREFIX));
  for (const [key, value] of incoming) {
    if (!allowed.has(key) && !key.startsWith(FILTER_RANKS_PREFIX)) continue;
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const key of preferenceKeys()) {
    if (!(key in input.preferences)) localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event('rankme:preferenceschange'));
  window.dispatchEvent(new Event('rankme:customrankingchange'));
  window.dispatchEvent(new Event('rankme:overridechange'));
  window.dispatchEvent(new CustomEvent('rankme:personaldatachange'));
  return incoming.length;
}
