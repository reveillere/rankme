import { useEffect, useState } from 'react';
import { fetchSharedOverrides, getUseCommunityOverrides } from './matchOverrides';

// Fetches both portals' community-confirmed corrections once per page load,
// for callers that need to know -- across a whole list, not just one badge
// -- whether a given rank already has a community match (see needsReview
// in matchOverrides.js, used by ReviewFilterToggle.js). fetchSharedOverrides
// itself caches one in-flight/resolved promise per portal, so this doesn't
// duplicate the network request RankBadge.js/Publications.js already make
// for the same data. Returns {} while community overrides are turned off
// or still loading -- getSharedOverride already treats a missing map entry
// as "no shared match", so callers don't need to special-case that.
export function useSharedOverridesMaps() {
  const [maps, setMaps] = useState({});
  useEffect(() => {
    if (!getUseCommunityOverrides()) return;
    let cancelled = false;
    Promise.all([fetchSharedOverrides('core'), fetchSharedOverrides('sjr')]).then(([core, sjr]) => {
      if (!cancelled) setMaps({ core, sjr });
    });
    return () => { cancelled = true; };
  }, []);
  return maps;
}
