// Which ranking source computes a publication's rank: the default CORE
// (conferences) + SJR/Scimago (journals) combination, or CCF (China
// Computer Federation) as a full alternative -- not merged with the
// default, a swap, since CCF ranks both conferences and journals on one
// A/B/C scale (see api/src/ccfPortal.js). Unlike e.g.
// getUseCommunityOverrides (a one-off preference read fresh only where
// needed), this one IS part of FilterSettingsContext -- switching it needs
// to be visible everywhere at once (the toolbar badge, the category
// filters, every open tab's stream) without a page reload, which a plain
// localStorage read can't do on its own. This file stays the actual
// persistence layer (get/set/validate against RANKING_SOURCES); the
// context is what makes changes to it propagate live.
const STORAGE_KEY = 'rankme:rankingSource';

// label is for the Settings radio (where "(default)" is useful context);
// shortLabel is for RankingSourceIndicator's toolbar badge, where the
// current tab's own ranking source is what matters, not whether it happens
// to be the default one.
export const RANKING_SOURCES = {
  'core-sjr': { label: 'CORE + SJR (default)', shortLabel: 'CORE + SJR' },
  'ccf': { label: 'CCF', shortLabel: 'CCF' },
};

export function getRankingSource() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored in RANKING_SOURCES ? stored : 'core-sjr';
  } catch {
    return 'core-sjr';
  }
}

export function setRankingSource(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* best-effort */ }
}

// Appended to a streaming endpoint's URL (Author.js/AuthorHal.js/
// Structure.js/Team.js, via useFilterSettings()'s live `rankingSource` --
// not read from storage directly here, so that a change actually produces
// a new URL string and re-triggers the stream, instead of only taking
// effect after a reload) -- authorStream.js's rankingSourceFrom reads this
// same 'source' query param server-side. Omitted entirely for the default,
// matching today's behavior with no param at all.
export function rankingSourceQueryParam(source) {
  return source === 'ccf' ? '?source=ccf' : '';
}
