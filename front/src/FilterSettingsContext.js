import { createContext, useContext, useState, useEffect } from 'react';
import { dblpCategories } from './dblp';
import { halCategories } from './hal';
import * as CorePortal from './corePortal';
import * as SjrPortal from './sjrPortal';

// Ranks are already a shared taxonomy between the dblp and HAL author views
// (both merge CorePortal + SjrPortal), so a single global selection covers
// both. Categories are source-specific taxonomies, so they get one
// selection each.
export const ranks = { ...CorePortal.ranks, ...SjrPortal.ranks };

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
  const [filterCategoriesDblp, setFilterCategoriesDblp] = usePersistedSelection('rankme:filterCategoriesDblp', dblpCategories);
  const [filterCategoriesHal, setFilterCategoriesHal] = usePersistedSelection('rankme:filterCategoriesHal', halCategories);

  return (
    <FilterSettingsContext.Provider value={{
      filterRanks, setFilterRanks,
      filterCategoriesDblp, setFilterCategoriesDblp,
      filterCategoriesHal, setFilterCategoriesHal,
    }}>
      {children}
    </FilterSettingsContext.Provider>
  );
}

export function useFilterSettings() {
  return useContext(FilterSettingsContext);
}
