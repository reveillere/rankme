import { createContext, useContext, useState, useEffect } from 'react';
import { dblpCategories } from './dblp';
import * as CorePortal from './corePortal';
import * as SjrPortal from './sjrPortal';

// Ranks are already a shared taxonomy between the dblp and HAL author views
// (both merge CorePortal + SjrPortal), so a single global selection covers
// both. Categories are shared too: every HAL category already declares
// which of these 6 dblp buckets it belongs to (hal.js's cssClass field, via
// getHalCategory), so one selection covers both sources — callers map a HAL
// publication's raw type to its bucket with getHalCategory(type).cssClass
// before checking it against filterCategories.
export const ranks = { ...CorePortal.ranks, ...SjrPortal.ranks };
export const categories = dblpCategories;

const allSelected = (data) => Object.keys(data).reduce((acc, key) => ({ ...acc, [key]: true }), {});

// Merges the persisted selection onto today's defaults on load, so a rank or
// category added to the app after a user already saved a preference starts
// out selected instead of silently missing (and excluded) from every chart.
function usePersistedSelection(storageKey, data) {
  const [selected, setSelected] = useState(() => {
    const defaults = allSelected(data);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      return stored ? { ...defaults, ...stored } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(selected));
  }, [storageKey, selected]);

  return [selected, setSelected];
}

const FilterSettingsContext = createContext(null);

export function FilterSettingsProvider({ children }) {
  const [filterRanks, setFilterRanks] = usePersistedSelection('rankme:filterRanks', ranks);
  const [filterCategories, setFilterCategories] = usePersistedSelection('rankme:filterCategories', categories);

  return (
    <FilterSettingsContext.Provider value={{
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
