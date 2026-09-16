import React, { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { dblpCategories } from '../dblp';
import '../App.css';
import { trimLastDigits } from '../utils'
import Tooltip from '@mui/material/Tooltip';
import { RankBadge } from './RankBadge';
import { DoiChip } from './DoiChip';
import { getOverride, getSharedOverride } from '../matchOverrides';
import { orderPublicationsForDisplay } from '../rankOrder';

// dblp's own <ee> element(s) -- usually a DOI link, but a record can carry
// several (e.g. also an arXiv mirror) and a repeated field comes back as an
// array rather than a lone string (see admin.js's wireRecordParser) -- so
// this accepts either shape and returns the first entry that's actually a
// doi.org link, ready to use directly as an href. Exported so CrossCheck.js
// derives a dblp record's DOI link the exact same way this file already
// does, instead of a second, possibly-drifting implementation.
export function findDoiUrl(ee) {
  const urls = Array.isArray(ee) ? ee : (ee ? [ee] : []);
  return urls.find(u => /^https?:\/\/doi\.org\//i.test(u)) || null;
}

const title = (o) => {
  if (typeof o === 'object')
    return (<>
      <i>{o.i}</i>{o._}</>
    );
  return <>{o}</>;
}

// A big author/team page re-flushes `data` on a timer while ranks stream in
// (see useRankedPublications.js) -- each flush only actually changes a
// handful of items, but every *other* item keeps the exact same object
// reference (the flush mutates in place). Without memoizing the row itself,
// React re-executes every row's render function on every flush regardless,
// which is what actually froze the tab for a large list (see the identical
// fix and its comment in HalPublications.js). pids/onOpenAuthor need to
// stay referentially stable for this to pay off -- see the pids useMemo
// below.
//
// sharedMaps is threaded all the way down from the container (see
// Publications() below) instead of RankBadge/Venue each fetching it
// themselves -- see RankBadge.js's own comment. It only ever changes once,
// when the community-overrides fetch resolves, so including it here doesn't
// cost anything beyond that one occasion.
//
// A *personal* override change is handled differently: setting/confirming/
// clearing one doesn't touch the publication object itself (only what
// localStorage says about it), so nothing about this row's props changes
// when it happens -- the only way to see it is a callback (overrideChangeTick
// below), bubbled up from wherever inside this row actually made the change
// (currently only RankBadge -> RankDetailsPopover, see RankBadge.js), that
// forces *this* row's own state to change instead. That's deliberately
// row-scoped, not a page-wide signal: it's what lets React.memo below still
// skip every *other* row when one row's match gets corrected, on a page
// that can have thousands of them (see this file's other row-froze comment).
// The trade-off is that a different row sharing the exact same (portal,
// edition, venue text) override key won't visually update until it
// re-renders for some other reason (e.g. the next streamed flush, or a
// filter change) -- acceptable since that's a rare coincidence, not the
// common case this fix targets.
//
// Only renders the row's *inner* content now -- the wrapping <li> (with its
// "year"/"entry <type>" className) moved to PublicationsItem below, since
// Virtuoso owns the wrapping element it measures for virtualization.
//
// Exported (like findDoiUrl above) so CrossCheck.js can render a DBLP
// publication exactly like the plain author page does -- colored type box,
// rank badge, clickable co-authors, Venue -- instead of the plain-text
// ListItemText it used to have of its own. CrossCheck.js's own list is at
// most a few dozen items, so it renders these directly in a plain map, with
// no Virtuoso involved.
export const PublicationRow = React.memo(function PublicationRow({ item, nr, pids, onOpenAuthor, sharedMaps, activeCustomProfileIds }) {
  const year = item.dblp.year;
  const [, forceRowRefresh] = useState(0);
  const portal = item.rank?.source?.startsWith('CCF') ? 'ccf' : (item.type === 'inproceedings' ? 'core' : 'sjr');
  // Same item.type split as `portal` above, since a custom profile can only
  // ever be active for a genuinely CORE/SJR-sourced item anyway (decision
  // 2 -- see customRankings.js's customProfileIdForPortal) -- picking the
  // right half of activeCustomProfileIds this way, not from `portal`
  // itself, is what lets it stay correct even for the (never actually
  // reached together) 'ccf' case.
  const activeCustomProfileId = item.type === 'inproceedings' ? activeCustomProfileIds?.conference : activeCustomProfileIds?.journal;
  return (
    <>
      <Tooltip title={dblpCategories[item.type].name} placement="left">
        <div className="box">
          <img alt="paper" src="https://dblp.org/img/n.png" />
        </div>
      </Tooltip>
      {/* nr is omitted (not just blank) by callers numbering a publication
          in a scope narrower than "this whole author/team" (e.g.
          CrossCheck.js's "To review" section, where it would sit right next
          to a HAL candidate row that never gets one either -- see
          HalPublicationRow's identical comment for why). */}
      {nr && <div className="nr">[{nr}]</div>}
      <div className="rank">
      <RankBadge rank={item.rank} portal={portal} year={year} resolvedFullName={item.fullName} sharedMaps={sharedMaps} activeCustomProfileId={activeCustomProfileId} onOverrideChange={() => forceRowRefresh(t => t + 1)} />
      </div>
      <cite className='data'>
        {
          item.authors.length > 0
            ? item.authors
              .map((a, i) => (
                <span key={i} className="link">
                  {!a.$.pid ? (
                    // No pid for this author -- e.g. every
                    // co-author from the local dump import (see
                    // dblpLocal.js), which carries no per-author
                    // pid at all -- so there's nothing to link
                    // to or compare against pids/selfPids.
                    <span>{trimLastDigits(a._)}</span>
                  ) : !pids.includes(a.$.pid) ? (
                    <a href="#" onClick={(e) => {
                      e.preventDefault();
                      onOpenAuthor({ type: 'dblp-author', id: `dblp:${a.$.pid}`, label: trimLastDigits(a._), pid: a.$.pid });
                    }}>
                      {trimLastDigits(a._)}
                    </a>
                  ) : (
                    <span className="self-author">{trimLastDigits(a._)}</span>
                  )}
                </span>
              ))
              .reduce((prev, curr) => [prev, ', ', curr])
            : <span>No Authors Listed</span>
        }
        <br />
        <span className='title'>
          {title(item.dblp.title)}
        </span>
        <Venue item={item} sharedMaps={sharedMaps} />
      </cite>
    </>
  );
});

// See HalPublications.js's HalList/HalItem for why these overrides exist:
// Virtuoso needs to own the item-wrapping element for measurement, so the
// <li> (with its "year"/"entry <type>" className) is supplied here instead
// of by PublicationRow. `row` is whatever `itemContent` was handed for that
// index -- see the flattened `rows` built in Publications below.
const PublicationsList = React.forwardRef(function PublicationsList({ style, children, ...props }, ref) {
  return <ul className='publ-list' ref={ref} style={style} {...props}>{children}</ul>;
});

// row can be undefined for a transient render -- see the identical
// computeItemKey/itemContent comment further below (data can change length
// between flushes while Virtuoso's own internal range tracking is briefly a
// tick behind). Virtuoso calls this wrapper independently of itemContent,
// so it needs its own guard rather than relying on itemContent's.
// row.kind is 'entry' for a publication row, or a group header otherwise --
// 'year' (date-first sort modes) or 'rankTier' (rank-first mode, see
// Publications()'s own rows useMemo) both get the same 'year' class: it's
// purely a header style (small, bold -- see App.css's ul.publ-list>li.year),
// not literally about years, so a rank-tier header reuses it rather than
// needing its own CSS rule.
const PublicationsItem = React.forwardRef(function PublicationsItem({ item: row, children, style, ...props }, ref) {
  const className = !row ? '' : row.kind === 'entry' ? `entry ${row.item.type}` : 'year';
  return <li className={className} ref={ref} style={style} {...props}>{children}</li>;
});

// Trailing breathing room below the last row -- a plain sibling div after
// <Virtuoso> (as this used to be, in Author.js) isn't reliable: with
// useWindowScroll, Virtuoso keeps revising its own estimate of total
// content height as rows get measured while you scroll, so a fixed-height
// element living outside that measurement can end up not yet accounted for
// exactly when a scroll gesture reaches what Virtuoso currently believes is
// the bottom -- the last row lands flush against the window edge instead.
// A Footer component is measured by Virtuoso itself, so it's always
// included in the same height calculation as every other row.
function PublicationsFooter() {
  return <div style={{ height: '60px' }} />;
}

// sharedMaps: see PublicationRow's own comment above -- comes from one
// useSharedOverridesMaps() call at the container (Author.js/Team.js) and is
// threaded down to every row. isActive is false for a tab currently sitting
// behind another one (see App.js) -- the row list is the expensive part of
// this page (it's what re-renders on every streamed SSE flush, ~7x/second
// while a stream is active), so it's skipped entirely while backgrounded;
// the data-fetching hook that owns the actual SSE subscription lives in the
// caller (AuthorContent et al.), not here, so it keeps accumulating
// regardless and switching back shows current data immediately.
export function Publications({ author, data, onOpenAuthor, selfPids, sharedMaps, activeCustomProfileIds, isActive = true, sortMode = 'date' }) {
  // A stable reference -- `selfPids || [author.pid]` would otherwise
  // recompute to a brand new array every render (breaking PublicationRow's
  // memoization above for every single row), even though the actual pid
  // list only ever changes if selfPids or author.pid themselves change.
  // author itself is undefined for Team.js's dblp path (selfPids always
  // provided there instead) -- optional chaining so that path never
  // touches author.pid at all, consistent with the pre-existing fallback.
  const pids = useMemo(() => selfPids || [author?.pid], [selfPids, author?.pid]);

  // nr (e.g. "[j5]") numbers each publication within its own category, most
  // recent first -- depends on iteration order over the sorted list, not
  // just the item itself, so it's precomputed here in one pass rather than
  // inside the (memoized, per-item-only) row above.
  //
  // Flattened (a "year" marker row inserted wherever the year changes,
  // rather than a per-entry displayYear flag) so each Virtuoso index below
  // is exactly one <li> -- see HalPublications.js's identical rows shape
  // for why: it's what lets a large list mount only its visible rows
  // instead of every one of them at once.
  const rows = useMemo(() => {
    // Skipped while backgrounded (isActive false, see App.js) -- this sort
    // + pass over every publication is real work on a large list, and
    // there's no Virtuoso below to consume it anyway (see the early return
    // further down). Still a real useMemo call either way (never
    // conditional on isActive) so hook order stays identical across
    // renders; recomputes for real the moment this tab becomes active again,
    // picking up whatever `data` changed to while hidden.
    if (!isActive) return [];
    // .dblp.year, not the nonexistent top-level .year -- this comparator
    // was always comparing undefined-undefined (NaN, a no-op for sort),
    // silently relying on dblpLocal.js's own pre-sort of `data` server-side
    // to already be in the right order.
    const pubs = [...data].sort((a, b) => (b.dblp.year || 0) - (a.dblp.year || 0));
    const typeCounts = data.reduce((acc, curr) => {
      acc[curr.type] = (acc[curr.type] || 0) + 1;
      return acc;
    }, {});
    // nr (e.g. "[j5]") is computed here, once, walking `pubs` in this fixed
    // year-descending order -- regardless of sortMode below. A publication's
    // number must stay the same no matter which sort/group view is currently
    // showing, or the same entry would appear to change its own number
    // every time the reader switches modes, which would be confusing rather
    // than useful.
    const numbered = pubs.map(item => ({
      item,
      nr: dblpCategories[item.type].letter + typeCounts[item.type]--,
    }));
    // dblp.key (the record's own <key> attribute), not dblp.url: url isn't
    // reliably unique (DBLP groups some distinct records, e.g. several
    // different RFCs, under one shared bibliography page url) -- see
    // dblpLocal.js's identical comment on why this matters for Virtuoso's
    // row identity specifically.
    const entryRow = ({ item, nr }) => ({ kind: 'entry', key: item.dblp.key, item, nr });

    // The grouping/ordering itself lives in rankOrder.js's
    // orderPublicationsForDisplay -- shared with exportPublications.js so a
    // downloaded CSV/Markdown file groups its rows exactly the way this page
    // currently does, instead of a second, possibly-drifting implementation
    // of the same algorithm. Reconstructed back into this file's own
    // 'entry'/'year'/'rankTier' row shape below, unchanged from before this
    // was extracted.
    const ordered = orderPublicationsForDisplay(numbered, sortMode, {
      yearOf: entry => entry.item.dblp.year,
      rankOf: entry => entry.item.rank,
    });
    return ordered.map(row => row.kind === 'item'
      ? entryRow(row.record)
      : row.groupKind === 'rankTier'
        ? { kind: 'rankTier', key: `rankTier-${row.tier}`, tier: row.tier, label: row.label }
        : { kind: 'year', key: `year-${row.year}`, year: row.year });
  }, [data, isActive, sortMode]);

  // The row list is what's expensive here (it's what re-renders on every
  // streamed SSE flush) -- a backgrounded tab still gets this far (pids/rows
  // above still run, cheaply, so hook order never changes across an
  // isActive flip) but doesn't need Virtuoso mounted at all behind
  // display:none. Data keeps accumulating in the caller regardless (its
  // useRankedPublications/useMergedRankedPublications call lives above this
  // component, not inside it), so reactivating the tab remounts Virtuoso
  // straight onto current data.
  if (!isActive) return null;

  return (
    <Virtuoso
      // See HalPublications.js's identical Virtuoso style prop for why this
      // is needed: .App is a flex column with align-items:center, so
      // Virtuoso's own root div (the actual flex child here) would
      // otherwise shrink-to-fit based on whatever rows happen to be
      // mounted, instead of spanning the page like the list used to.
      style={{ width: '100%' }}
      useWindowScroll
      // See HalPublications.js's identical initialItemCount for why: the
      // first-paint probe-and-measure bootstrap depends on a ResizeObserver
      // callback firing, which this forces past instead of waiting on.
      // Clamped to rows.length -- Virtuoso otherwise asks computeItemKey
      // for indices past the end of a short list (e.g. a ~20-publication
      // author, whose rows array is under 30 including year markers),
      // which crashed the whole page (row was undefined, "Cannot read
      // properties of undefined (reading 'key')").
      initialItemCount={Math.min(30, rows.length)}
      data={rows}
      // row can still be undefined for a transient render: `data`
      // (filteredRecords, computed in the container's effect) can change
      // length between one flush and the next as ranks resolve -- a
      // publication's filter/review-only inclusion can depend on its rank,
      // which arrives asynchronously -- and Virtuoso's own internal range
      // tracking can briefly ask for an index one tick behind that change.
      // Defensive fallbacks here (rather than trying to prevent the
      // transient length change upstream) so that one-tick mismatch never
      // crashes the whole page; the next render immediately after has the
      // correct, up-to-date rows.
      computeItemKey={(index, row) => row?.key ?? `missing-${index}`}
      components={{ List: PublicationsList, Item: PublicationsItem, Footer: PublicationsFooter }}
      itemContent={(index, row) => !row
        ? null
        : row.kind === 'entry'
          ? <PublicationRow item={row.item} nr={row.nr} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
          : row.kind === 'rankTier'
            ? row.label
            : row.year}
    />
  );
}

// sharedMaps: see PublicationRow's comment above -- threaded down from the
// container instead of this component fetching it itself. It used to (each
// row's own Venue independently called fetchSharedOverrides and also
// subscribed to matchOverrides.js's 'rankme:overridechange' window event to
// catch a personal override change) -- on a large list that meant every
// mounted row's Venue re-rendered on *any* override write anywhere on the
// page, entirely bypassing PublicationRow's React.memo above (each Venue's
// own state change, not a prop change, is what forced it). Now this
// component has no state of its own at all: it's a plain function of
// item/sharedMaps, recomputed whenever PublicationRow itself re-renders --
// which for a personal override change only happens for the one row whose
// own RankBadge/popover made the change (see PublicationRow's
// forceRowRefresh), not for every row on the page.
function Venue({ item, sharedMaps }) {
  let link;
  let extra;

  const { type, venue: rawVenue, dblp: { pages, volume, number, year, journal, publisher, isbn, ee } = {} } = item || {};
  const doiUrl = findDoiUrl(ee);
  const portal = type === 'inproceedings' ? 'core' : 'sjr';

  // Mirrors RankBadge's own override lookup (personal wins over shared) so
  // that correcting a match here -- via the rank badge's popover -- also
  // updates the venue name shown right next to it, instead of leaving the
  // old (wrong) name displayed under a now-corrected rank.
  const sharedMap = sharedMaps?.[portal];

  const override = item.rank ? getOverride(portal, item.rank) : null;
  const sharedOverride = !override && item.rank ? getSharedOverride(item.rank, sharedMap) : null;
  const overrideCandidate = override?.candidate || sharedOverride?.candidate;
  // Same "title (ACRONYM)" shape RankDetailsPopover.js already shows for a
  // matched/overridden entry -- without the acronym here, a conference
  // known mainly by its short name (e.g. "International Conference on
  // Service Oriented Computing (ICSOC)") would only show the generic long
  // title, losing exactly the part a reader is most likely to recognize.
  const withAcronym = (title, acronym) => title ? `${title}${acronym ? ` (${acronym})` : ''}` : null;
  // dblp's own <journal>/<booktitle> text is very often heavily
  // abbreviated (e.g. "Empir. Softw. Eng."), or (for a conference) just a
  // bare acronym -- names to pick the clearest from, best first: a
  // manual/community correction of the match (the reader picked this one
  // on purpose, so it always wins); CORE/SJR's own matchedTitle (the
  // ranking source's official name for whatever it actually matched, e.g.
  // "Empirical Software Engineering" or "ACM Symposium on Applied
  // Computing" -- often cleaner than Crossref's own title, which tends to
  // carry "Proceedings of the Nth..." framing); item.fullName, Crossref's
  // title for this record's DOI (see authorStream.js), when there's no
  // matchedTitle to prefer (no match at all, or an unresolved ambiguity);
  // and dblp's own raw text as the last resort -- but only for an 'exact'
  // match: a 'fuzzy' one is just the automatic system's best guess, not
  // confirmed by anyone yet, so showing its matchedTitle as if it were the
  // real name would state a guess as fact. ('ambiguous' never sets
  // matchedTitle at all, so it already falls through on its own.) Once a
  // reader actually confirms a fuzzy match (confirmMatch, RankDetailsPopover.js)
  // it becomes an override carrying that same title -- caught by the first
  // rung above, which is why this rung only needs to gate the *un*confirmed
  // case.
  const useMatchedTitle = item.rank?.matchType === 'exact';
  // A markAsUnranked override (RankDetailsPopover.js) has no title of its
  // own -- title/acronym are both null, only value ("Unranked") is set --
  // specifically to say "the automatic match itself was wrong, this venue
  // isn't ranked at all." Falling through to that same rejected
  // rank.matchedTitle next would show right back the name the override was
  // just made to get rid of; skipping straight to the venue's own original
  // text (fullName/rawVenue) is what "unranked" is actually saying.
  const isMarkedUnranked = overrideCandidate && overrideCandidate.value === 'Unranked' && !overrideCandidate.title;
  const venue = withAcronym(overrideCandidate?.title, overrideCandidate?.acronym)
    || (isMarkedUnranked || !useMatchedTitle ? null : withAcronym(item.rank?.matchedTitle, item.rank?.matchedAcronym))
    || item.fullName
    || rawVenue;

  switch(type) {
    case 'article':
      link = (
        <>
          {venue} {volume}{number && `(${number})`}{pages && `: ${pages}`}
        </>
      );
      extra = <> ({year})</>;
      break;
    case 'inproceedings':
      link = <>{venue} {year}</>;
      extra = pages && <>: {pages}</>;
      break;
    case 'informal':
      link = <>{journal} {volume}</>;
      extra = <>({year})</>;
      break;
    case 'proceedings':
      link = <>{publisher} {year}, ISBN {isbn}</>;
      extra = <>{venue} {year} {pages} ({year})</>;
      break;
    case 'book':
      extra = <>{venue} {year} {pages}</>;
      break;
    case 'incollection':
      extra = <>{venue} {year} {pages} ({year})</>;
      break;
    default:
      extra = <>{venue} {year} {pages} ({year})</>;
  }

  return (
    <span className='link'>
      <span className='venue'>
        {venue !== rawVenue ? (
          <Tooltip title={<div>dblp: &quot;{rawVenue}&quot;</div>} placement="bottom">
            <span>{link}</span>
          </Tooltip>
        ) : (
          link
        )}
         {extra}
        <DoiChip url={doiUrl} />
      </span>
    </span>
  );
}
