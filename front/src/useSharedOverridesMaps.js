import { useEffect, useState } from 'react';
import { fetchSharedOverrides, getUseCommunityOverrides } from './matchOverrides';

// Fetches every portal's community-confirmed corrections once per page load,
// for callers that need to know -- across a whole list, not just one badge
// -- whether a given rank already has a community match (see needsReview
// in matchOverrides.js, used by ReviewFilterToggle.js). fetchSharedOverrides
// itself caches one in-flight/resolved promise per portal, so this doesn't
// duplicate the network request RankBadge.js/Publications.js already make
// for the same data. Returns {} while community overrides are turned off
// or still loading -- getSharedOverride already treats a missing map entry
// as "no shared match", so callers don't need to special-case that.
//
// All 3 known portals now (core/sjr/ccf) -- community promotion used to be
// core/sjr only (api/src/matchOverrides.js's own KNOWN_PORTALS), with no
// recorded reason CCF was left out despite its HAL-venue fuzzy match being
// just as capable of mismatching a venue.
const PORTALS = ['core', 'sjr', 'ccf'];

export function useSharedOverridesMaps() {
  const [maps, setMaps] = useState({});
  useEffect(() => {
    if (!getUseCommunityOverrides()) return;
    let cancelled = false;
    Promise.all(PORTALS.map(fetchSharedOverrides)).then(results => {
      if (!cancelled) setMaps(Object.fromEntries(PORTALS.map((portal, i) => [portal, results[i]])));
    });
    return () => { cancelled = true; };
  }, []);
  return maps;
}
