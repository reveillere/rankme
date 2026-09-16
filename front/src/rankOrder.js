// A single shared scale that lets a conference rank (CORE/CCF: A*, A, B, C)
// and a journal rank (SJR: Q1-Q4) be compared and grouped together for the
// "rank, then date" sort mode -- CORE/CCF and SJR are different portals with
// disjoint value sets (see api/src/corePortal.js's RANKS and
// api/src/sjrPortal.js), so there is no natural single ordering between e.g.
// 'A' and 'Q2' without this table. Used by both Publications.js and
// HalPublications.js -- kept here once rather than duplicated, since a
// mismatch between the two would silently put the same publication in a
// different tier depending on which page it's viewed from.
const TIER_BY_VALUE = {
  'A*': 1, 'Q1': 1,
  'A': 2, 'Q2': 2,
  'B': 3, 'Q3': 3,
  'C': 4, 'Q4': 4,
  'Misc': 5,
  'Unranked': 6,
};

const TIER_LABELS = {
  1: 'A* / Q1',
  2: 'A / Q2',
  3: 'B / Q3',
  4: 'C / Q4',
  5: 'Misc',
  6: 'Unranked',
};

// Accepts the same `rank` shape carried on a publication item (item.rank --
// { value, ... }), or undefined/null for a publication with no match at all
// (e.g. still pending on the SSE stream, or genuinely never matched) --
// treated the same as an explicit 'Unranked', tier 6, the lowest/last tier.
export function rankTier(rank) {
  return TIER_BY_VALUE[rank?.value] || 6;
}

// Header label for a rank-tier group, e.g. shown in place of a year header
// when grouping by rank (see Publications.js/HalPublications.js's `rankTier`
// row kind).
export function rankTierLabel(tier) {
  return TIER_LABELS[tier] || TIER_LABELS[6];
}

// The three sort modes offered by SortButton.js, threaded end to end from
// the URL (?sort=, see App.js's tabPath/tabFromPath) down to
// Publications.js/HalPublications.js's own `rows` useMemo. 'date' is the
// default and is never actually written to the URL (same "omit when it's
// the default" rule App.js already applies to yearRange).
export const SORT_MODES = ['date', 'date-rank', 'rank-date'];
export const DEFAULT_SORT_MODE = 'date';

// Pure grouping/ordering shared by Publications.js/HalPublications.js's own
// `rows` useMemo and exportPublications.js's CSV/Markdown export -- kept
// here once, rather than copied a third time for export, so a downloaded
// file groups its rows exactly the same way the page currently on screen
// does. `items` is a caller-defined array of opaque per-publication values
// (Publications.js's own {item, nr} pair for display, or a raw dblp/hal
// record for export, which has no nr at all) -- this function only ever
// touches an item through yearOf/rankOf, never assumes a shape of its own,
// so the exact same code runs for both callers' different item shapes.
//
// Returns a flat list of group markers and items in display order:
//   { kind: 'group', groupKind: 'year', year }
//   { kind: 'group', groupKind: 'rankTier', tier, label }
//   { kind: 'item', record }
// mirroring the 'year'/'rankTier'/'entry' row kinds Publications.js's own
// rows array used before this was extracted -- each caller reconstructs its
// own row shape (key, nr, ...) from this.
export function orderPublicationsForDisplay(items, sortMode, { yearOf, rankOf }) {
  const sorted = [...items].sort((a, b) => (yearOf(b) || 0) - (yearOf(a) || 0));

  if (sortMode === 'rank-date') {
    // Grouped by rank tier instead of by year -- each tier's own items stay
    // in the year-descending order `sorted` already has them in
    // (Array.prototype.sort is stable), so within a tier it still reads
    // newest-first.
    const byTier = new Map();
    for (const item of sorted) {
      const tier = rankTier(rankOf(item));
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(item);
    }
    const out = [];
    for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
      out.push({ kind: 'group', groupKind: 'rankTier', tier, label: rankTierLabel(tier) });
      out.push(...byTier.get(tier).map(record => ({ kind: 'item', record })));
    }
    return out;
  }

  // 'date' and 'date-rank' both group by year -- only the order *within*
  // each year group differs: arrival order for 'date', best rank first for
  // 'date-rank'.
  const out = [];
  let previousYear = null;
  let yearGroup = [];
  const flushYearGroup = () => {
    if (sortMode === 'date-rank') yearGroup.sort((a, b) => rankTier(rankOf(a)) - rankTier(rankOf(b)));
    out.push(...yearGroup.map(record => ({ kind: 'item', record })));
    yearGroup = [];
  };
  for (const item of sorted) {
    const year = yearOf(item);
    if (previousYear !== year) {
      flushYearGroup();
      out.push({ kind: 'group', groupKind: 'year', year });
      previousYear = year;
    }
    yearGroup.push(item);
  }
  flushYearGroup();
  return out;
}
