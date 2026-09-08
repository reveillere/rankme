import { useState } from 'react';

import { RankDetailsPopover, MATCH_STYLE } from './RankDetailsPopover';
import { getOverride } from '../matchOverrides';

// A rank badge is clickable: it opens RankDetailsPopover, which shows what
// year/edition it was computed against, what it matched (or why it
// couldn't), how confident that match is, and a search box to replace it
// with a different entry. portal is 'core' (conferences) or 'sjr'
// (journals) -- it picks which candidate-search endpoint and which local
// override bucket apply. year is the publication's own year.
export function RankBadge({ rank, portal, year }) {
  const [anchorEl, setAnchorEl] = useState(null);
  // Bumped after a local override is set/cleared to force this render to
  // re-read localStorage below. NOT computed once via useState(() => ...):
  // ranks stream in over SSE well after this component first mounts (with
  // rank still undefined), so a one-time initializer would permanently miss
  // an override that was already saved for this exact match on an earlier
  // visit -- it would only ever "see" one set live in the current session.
  const [refreshTick, setRefreshTick] = useState(0);

  if (!rank) return null;

  const override = getOverride(portal, rank);
  const isConfirmed = override?.type === 'confirmed';
  const effective = override
    ? { value: override.candidate.value, matchType: isConfirmed ? 'confirmed' : 'manual' }
    : { value: rank.value, matchType: rank.matchType };
  const style = MATCH_STYLE[effective.matchType] || MATCH_STYLE.none;
  // "none" (Unranked/QU) already reads clearly as a label on its own, so it
  // stays in the default color; every other case -- an exact match, an
  // approximate guess, an unresolved ambiguity, or a manual correction --
  // gets its confidence color.
  const colored = effective.matchType !== 'none';

  return (
    <>
      <span
        onClick={(e) => setAnchorEl(e.currentTarget)}
        style={{ cursor: 'pointer', color: colored ? style.color : undefined }}
      >
        {effective.value}
      </span>
      <RankDetailsPopover
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        portal={portal}
        year={year}
        rank={rank}
        override={override}
        onOverrideChange={() => setRefreshTick(t => t + 1)}
      />
    </>
  );
}
