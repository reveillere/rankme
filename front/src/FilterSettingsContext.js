import { createContext, useContext, useState, useEffect } from 'react';
import { dblpCategories } from './dblp';
import * as CorePortal from './corePortal';
import * as SjrPortal from './sjrPortal';
import * as CcfPortal from './ccfPortal';
import { getRankingSource, setRankingSource as persistRankingSource } from './rankingSource';

// Categories are shared between the dblp and HAL author views: every HAL
// category already declares which of these 6 dblp buckets it belongs to
// (hal.js's cssClass field, via getHalCategory), so one selection covers
// both sources -- callers map a HAL publication's raw type to its bucket
// with getHalCategory(type).cssClass before checking it against
// filterCategories.
export const categories = dblpCategories;

// CORE+SJR merged, or CCF alone (see rankingSource.js) -- computed fresh
// from whichever source is currently live in context, not a static export,
// so switching sources updates every consumer (charts, stats, the category
// filter popover) immediately rather than only after a reload.
function ranksForSource(source) {
  return source === 'ccf' ? CcfPortal.ranks : { ...CorePortal.ranks, ...SjrPortal.ranks };
}

const allSelected = (data) => Object.keys(data).reduce((acc, key) => ({ ...acc, [key]: true }), {});

function loadOrDefault(storageKey, data) {
  const defaults = allSelected(data);
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (!stored) return defaults;
    // Only keep stored entries for keys `data` still has. A rank code the
    // app used to expose (e.g. sjrPortal.js's old 'QU', renamed to
    // 'Unranked' to match corePortal.js's own convention) can still be
    // sitting in someone's already-saved selection from before that
    // change -- spreading every stored key over `defaults` unconditionally
    // would keep it alive forever as a key `ranks` no longer has, and every
    // consumer that assumes `Object.keys(selected)` all exist in `ranks`
    // (Statistics.js's labelAccessor, RankSummary.js) would crash on it,
    // exactly as this one did.
    const known = Object.fromEntries(Object.entries(stored).filter(([key]) => key in defaults));
    return { ...defaults, ...known };
  } catch {
    return defaults;
  }
}

// Merges the persisted selection onto today's defaults on load, so a rank or
// category added to the app after a user already saved a preference starts
// out selected instead of silently missing (and excluded) from every chart.
function usePersistedSelection(storageKey, data) {
  const [selected, setSelected] = useState(() => loadOrDefault(storageKey, data));
  const [prevKey, setPrevKey] = useState(storageKey);

  // storageKey changes when the ranking source does (filterRanks below is
  // keyed by source, see FilterSettingsProvider). Resetting this via a
  // useEffect ran one render *after* `ranks` (computed synchronously in
  // FilterSettingsProvider's body) had already switched shape -- for that one
  // transient render, `selected` still held the old source's keys (e.g. "A*",
  // "Q1") while `ranks` was already the new source's, so any consumer doing
  // `ranks[key]` for a still-selected old key (Statistics.js's labelAccessor,
  // RankSummary.js) read undefined and crashed. Resetting synchronously
  // during render instead -- React's documented pattern for "adjusting state
  // when a prop changes" -- means `selected` and `ranks` are always
  // recomputed together, before anything commits or paints.
  if (storageKey !== prevKey) {
    setPrevKey(storageKey);
    setSelected(loadOrDefault(storageKey, data));
  }

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(selected));
  }, [storageKey, selected]);

  return [selected, setSelected];
}

const FilterSettingsContext = createContext(null);

export function FilterSettingsProvider({ children }) {
  const [rankingSource, setRankingSourceState] = useState(getRankingSource);
  const ranks = ranksForSource(rankingSource);

  // Keyed by ranking source (not just 'rankme:filterRanks'): CORE+SJR and
  // CCF have different rank vocabularies that happen to share some literal
  // key names ("A", "B", "C", "Unranked") -- a single shared storage key
  // meant a selection saved under one source (e.g. unchecking CORE's "A*")
  // could silently carry over and mis-filter the other's same-named key
  // after switching.
  const [filterRanks, setFilterRanks] = usePersistedSelection(`rankme:filterRanks:${rankingSource}`, ranks);
  const [filterCategories, setFilterCategories] = usePersistedSelection('rankme:filterCategories', categories);

  const setRankingSource = (value) => {
    persistRankingSource(value);
    setRankingSourceState(value);
  };

  return (
    <FilterSettingsContext.Provider value={{
      rankingSource, setRankingSource, ranks,
      filterRanks, setFilterRanks,
      filterCategories, setFilterCategories,
    }}>
      {children}
    </FilterSettingsContext.Provider>
  );
}

export function useFilterSettings() {
  return useContext(FilterSettingsContext);
}
