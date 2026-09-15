import { useEffect, useState } from 'react';

// Bumped whenever any match override changes anywhere on the page (set,
// confirmed, or reset -- see matchOverrides.js's notifyChange), or any
// custom ranking entry does (see customRankings.js's own notifyChange --
// its own event, since editing a custom ranking and correcting a match are
// different actions, but both need the exact same "a rank's displayed value
// may have just changed" reaction here). Both live in localStorage, not
// React state, so nothing re-renders on their own when either changes --
// include this tick in a filtering effect's dependency array so a
// publication list (and any count derived from it, e.g.
// ReviewFilterToggle's "N to review", or a filterRanks checkbox's actual
// membership once a custom profile is active) updates live as the user
// works through corrections, instead of only on the next unrelated filter
// change or a full page reload.
export function useOverrideRefreshTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick(t => t + 1);
    window.addEventListener('rankme:overridechange', onChange);
    window.addEventListener('rankme:customrankingchange', onChange);
    return () => {
      window.removeEventListener('rankme:overridechange', onChange);
      window.removeEventListener('rankme:customrankingchange', onChange);
    };
  }, []);
  return tick;
}
