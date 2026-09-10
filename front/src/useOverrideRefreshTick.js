import { useEffect, useState } from 'react';

// Bumped whenever any match override changes anywhere on the page (set,
// confirmed, or reset -- see matchOverrides.js's notifyChange). Overrides
// live in localStorage, not React state, so nothing re-renders on their
// own when one changes -- include this tick in a filtering effect's
// dependency array so a publication list (and any count derived from it,
// e.g. ReviewFilterToggle's "N to review") updates live as the user works
// through corrections, instead of only on the next unrelated filter change
// or a full page reload.
export function useOverrideRefreshTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick(t => t + 1);
    window.addEventListener('rankme:overridechange', onChange);
    return () => window.removeEventListener('rankme:overridechange', onChange);
  }, []);
  return tick;
}
