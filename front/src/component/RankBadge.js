import { useEffect, useState } from 'react';

import { RankDetailsPopover, MATCH_STYLE } from './RankDetailsPopover';
import { getOverride, getSharedOverride } from '../matchOverrides';
import { getDisplayValue } from '../customRankings';

// A rank badge is clickable: it opens RankDetailsPopover, which shows what
// year/edition it was computed against, what it matched (or why it
// couldn't), how confident that match is, and a search box to replace it
// with a different entry. portal is 'core' (conferences), 'sjr'
// (journals), or 'ccf' (both, when the CCF ranking source is selected --
// see rankingSource.js) -- it picks which candidate-search endpoint and
// which local override bucket apply (sharedMaps?.[portal] is simply
// undefined for 'ccf', no community overrides exist for it yet -- personal
// overrides/confirmations, stored locally, work the same as CORE/SJR).
// year is the publication's own year. resolvedFullName
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
// activeCustomProfileId (nullable): set when the axis this badge belongs to
// (conference or journal, already resolved by the caller -- Publications.js/
// HalPublications.js pick the right half of activeCustomProfileIds by
// item.type, the same way they already pick the right half of sharedMaps)
// currently has a custom ranking profile active (see customRankings.js).
// When set, it overrides everything else below: a custom ranking is meant
// to stand in for the automatic match entirely once selected, the same way
// switching the axis to CCF would, not blend with a personal/community
// CORE-SJR correction (those still exist underneath -- entryKeyFor uses a
// match correction's own candidate id when there is one -- just not what's
// actually shown once a custom letter has taken over the axis).
//
// onOverrideChange is threaded the other way: it comes from the enclosing
// PublicationRow/HalPublicationRow (a per-*row* callback, not a page-wide
// one) and is just forwarded to the popover below. A personal override (or
// custom ranking edit) doesn't touch the underlying publication object at
// all (only what localStorage says about it), so nothing about this row's
// props changes when one happens -- calling this forces just the one row
// that made the change to re-render, without the page-wide
// 'rankme:overridechange'/'rankme:customrankingchange' window events this
// badge used to listen for directly (those are still dispatched by
// matchOverrides.js/customRankings.js's own write(), and still drive
// useOverrideRefreshTick() for the review-count/filter recompute at the
// container -- just not this).
export function RankBadge({ rank, portal, year, resolvedFullName, sharedMaps, activeCustomProfileId, onOverrideChange }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [, forceCustomRefresh] = useState(0);
  const sharedMap = sharedMaps?.[portal];

  // onOverrideChange above only refreshes *this* row -- fine for a personal
  // match correction (each row keys its own override independently), but a
  // custom ranking entry keyed by venue identity (entryKeyFor,
  // customRankings.js) is deliberately meant to affect every publication of
  // that venue at once, e.g. "apply to all editions" from one row's popover
  // -- and every *other* row showing the same venue is its own
  // React.memo'd component (Publications.js's PublicationRow) that never
  // gets told anything changed. Subscribed only while a custom profile is
  // actually active for this badge's own axis, so a page not using the
  // feature at all -- the common case -- pays nothing extra; Virtuoso only
  // mounts visible rows anyway, so even a huge list bounds this to what's
  // currently on screen.
  useEffect(() => {
    if (!activeCustomProfileId) return;
    const onChange = () => forceCustomRefresh(t => t + 1);
    window.addEventListener('rankme:customrankingchange', onChange);
    return () => window.removeEventListener('rankme:customrankingchange', onChange);
  }, [activeCustomProfileId]);

  if (!rank) return null;

  const override = getOverride(portal, rank);
  // Personal override always wins; a community one only applies when this
  // browser hasn't set its own (see RankDetailsPopover's identical rule).
  const sharedOverride = !override ? getSharedOverride(rank, sharedMap) : null;
  const isConfirmed = override?.type === 'confirmed';
  const effective = activeCustomProfileId
    ? { value: getDisplayValue(rank, { portal, sharedMap, customProfileId: activeCustomProfileId, override, year }), matchType: 'custom' }
    : override
      ? { value: override.candidate.value, matchType: isConfirmed ? 'confirmed' : 'manual' }
      : sharedOverride
        ? { value: sharedOverride.candidate.value, matchType: 'shared' }
        : { value: rank.value, matchType: rank.matchType };
  const style = MATCH_STYLE[effective.matchType] || MATCH_STYLE.none;
  // "none" (Unranked/QU) already reads clearly as a label on its own, so it
  // stays in the default color; every other case -- an exact match, an
  // approximate guess, an unresolved ambiguity, or a manual/community/custom
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
          activeCustomProfileId={activeCustomProfileId}
          onOverrideChange={onOverrideChange}
        />
      )}
    </>
  );
}
