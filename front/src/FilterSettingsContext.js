import { createContext, useContext, useState, useEffect } from 'react';
import { dblpCategories } from './dblp';
import * as CorePortal from './corePortal';
import * as SjrPortal from './sjrPortal';
import * as CcfPortal from './ccfPortal';
import { ranksForReference, getProfile as getCustomProfile } from './customRankings';
import {
  getConferenceSource, setConferenceSource as persistConferenceSource,
  getJournalSource, setJournalSource as persistJournalSource,
  customProfileIdFrom,
} from './rankingSource';

// Categories are shared between the dblp and HAL author views: every HAL
// category already declares which of these 6 dblp buckets it belongs to
// (hal.js's cssClass field, via getHalCategory), so one selection covers
// both sources -- callers map a HAL publication's raw type to its bucket
// with getHalCategory(type).cssClass before checking it against
// filterCategories.
export const categories = dblpCategories;

// Each axis's own rank vocabulary (see rankingSource.js) -- computed fresh
// from whichever source is currently live in context, not a static export,
// so switching either source updates every consumer (charts, stats, the
// category filter popover) immediately rather than only after a reload.
// Merged together below into a single `ranks` object: CCF picked for one
// axis and not the other still needs both vocabularies represented (e.g.
// conferences on CCF's A/B/C alongside journals on SJR's Q1-Q4). A
// custom:* source (customRankings.js) uses whichever letters its own
// *reference* ranking actually has (ranksForReference) -- a CORE-referenced
// profile's checkboxes/legend are exactly CORE's own A*/A/B/C/Misc/Unranked,
// not a blanket merge of every reference's letters, since nothing it covers
// could ever take a value outside its own reference's vocabulary. A stale
// or already-deleted profile (getCustomProfile returns null/undefined --
// the self-healing effect below will resolve the axis itself shortly after)
// falls back to ranksForReference's own default (CORE's set) rather than
// crashing in the meantime.
function ranksForConferenceSource(source) {
  if (source === 'ccf') return CcfPortal.ranks;
  const profileId = customProfileIdFrom(source);
  return profileId ? ranksForReference(getCustomProfile(profileId)?.reference) : CorePortal.ranks;
}

function ranksForJournalSource(source) {
  if (source === 'ccf') return CcfPortal.ranks;
  const profileId = customProfileIdFrom(source);
  return profileId ? ranksForReference(getCustomProfile(profileId)?.reference) : SjrPortal.ranks;
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
  const [conferenceSource, setConferenceSourceState] = useState(getConferenceSource);
  const [journalSource, setJournalSourceState] = useState(getJournalSource);
  const ranks = { ...ranksForConferenceSource(conferenceSource), ...ranksForJournalSource(journalSource) };

  // Keyed by both sources (not just 'rankme:filterRanks'): CORE/CCF and
  // SJR/CCF have different rank vocabularies that happen to share some
  // literal key names ("A", "B", "C", "Unranked") -- a single shared
  // storage key meant a selection saved under one pair (e.g. unchecking
  // CORE's "A*") could silently carry over and mis-filter the same-named
  // key under a different pair after switching either axis.
  const [filterRanks, setFilterRanks] = usePersistedSelection(`rankme:filterRanks:${conferenceSource}:${journalSource}`, ranks);
  const [filterCategories, setFilterCategories] = usePersistedSelection('rankme:filterCategories', categories);

  const setConferenceSource = (value) => {
    persistConferenceSource(value);
    setConferenceSourceState(value);
  };

  const setJournalSource = (value) => {
    persistJournalSource(value);
    setJournalSourceState(value);
  };

  // Decision 5: a custom profile currently selected as an axis's source can
  // be deleted (from MyCustomRankingsDialog.js, or another tab/window)
  // without that axis ever being touched directly -- silently fall back to
  // the default (CORE/SJR) the moment that happens, rather than leaving the
  // axis pointed at a profile that no longer resolves to anything (ranks
  // above would still render *some* palette -- ranksForReference's own
  // CORE fallback -- but getDisplayValue would have nothing to look up).
  // Checked once on mount (covers a profile
  // deleted in another tab before this one even loaded) and again on every
  // customRankings.js write (covers a deletion from a dialog within this
  // same page) -- persisted via the real setters, not just computed
  // in-memory, so Settings' own radio group reflects the fallback too
  // instead of showing neither option selected.
  useEffect(() => {
    const healIfStale = () => {
      const confProfileId = customProfileIdFrom(conferenceSource);
      if (confProfileId && !getCustomProfile(confProfileId)) setConferenceSource('core');
      const journalProfileId = customProfileIdFrom(journalSource);
      if (journalProfileId && !getCustomProfile(journalProfileId)) setJournalSource('sjr');
    };
    healIfStale();
    window.addEventListener('rankme:customrankingchange', healIfStale);
    return () => window.removeEventListener('rankme:customrankingchange', healIfStale);
  }, [conferenceSource, journalSource]);

  return (
    <FilterSettingsContext.Provider value={{
      conferenceSource, setConferenceSource,
      journalSource, setJournalSource,
      ranks,
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
