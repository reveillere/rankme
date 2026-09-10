import { useState } from 'react';

import { RankDetailsPopover, MATCH_STYLE } from './RankDetailsPopover';
import { getOverride, getSharedOverride } from '../matchOverrides';

// A rank badge is clickable: it opens RankDetailsPopover, which shows what
// year/edition it was computed against, what it matched (or why it
// couldn't), how confident that match is, and a search box to replace it
// with a different entry. portal is 'core' (conferences) or 'sjr'
// (journals) -- it picks which candidate-search endpoint and which local
// override bucket apply. year is the publication's own year. resolvedFullName
// (dblp publications only, see Publications.js) is Crossref's own venue
// title for this record's DOI, when authorStream.js's DOI fallback found
// one -- passed through so the popover can show it even on a match it
// *didn't* end up replacing (see RankDetailsPopover's own note on this).
//
// sharedMaps ({ core, sjr }, or {} while loading/disabled) comes from a
// single useSharedOverridesMaps() call at the container (Author.js,
// AuthorHal.js, Structure.js, Team.js) and is threaded down through
// Publications.js/HalPublications.js's row components -- this badge used to
// call fetchSharedOverrides itself, which meant every single badge on a
// large list independently subscribed and re-rendered on resolution.
//
// onOverrideChange is threaded the other way: it comes from the enclosing
// PublicationRow/HalPublicationRow (a per-*row* callback, not a page-wide
// one) and is just forwarded to the popover below. A personal override
// change doesn't touch the underlying publication object at all (only what
// localStorage says about it), so nothing about this row's props changes
// when one happens -- calling this forces just the one row that made the
// change to re-render, without the page-wide 'rankme:overridechange' window
// event this badge used to listen for directly (that's still dispatched by
// matchOverrides.js's write(), and still drives useOverrideRefreshTick()
// for the review-count/filter recompute at the container -- just not this).
export function RankBadge({ rank, portal, year, resolvedFullName, sharedMaps, onOverrideChange }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const sharedMap = sharedMaps?.[portal];

  if (!rank) return null;

  const override = getOverride(portal, rank);
  // Personal override always wins; a community one only applies when this
  // browser hasn't set its own (see RankDetailsPopover's identical rule).
  const sharedOverride = !override ? getSharedOverride(rank, sharedMap) : null;
  const isConfirmed = override?.type === 'confirmed';
  const effective = override
    ? { value: override.candidate.value, matchType: isConfirmed ? 'confirmed' : 'manual' }
    : sharedOverride
      ? { value: sharedOverride.candidate.value, matchType: 'shared' }
      : { value: rank.value, matchType: rank.matchType };
  const style = MATCH_STYLE[effective.matchType] || MATCH_STYLE.none;
  // "none" (Unranked/QU) already reads clearly as a label on its own, so it
  // stays in the default color; every other case -- an exact match, an
  // approximate guess, an unresolved ambiguity, or a manual/community
  // correction -- gets its confidence color.
  const colored = effective.matchType !== 'none';

  return (
    <>
      <span
        onClick={(e) => setAnchorEl(e.currentTarget)}
        style={{ cursor: 'pointer', color: colored ? style.color : undefined }}
      >
        {effective.value}
      </span>
      {anchorEl && (
        <RankDetailsPopover
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          portal={portal}
          year={year}
          rank={rank}
          override={override}
          sharedOverride={sharedOverride}
          resolvedFullName={resolvedFullName}
          onOverrideChange={onOverrideChange}
        />
      )}
    </>
  );
}
