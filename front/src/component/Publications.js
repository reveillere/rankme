import React, { useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { dblpCategories } from '../dblp';
import '../App.css';
import { trimLastDigits } from '../utils'
import Tooltip from '@mui/material/Tooltip';
import { RankBadge } from './RankBadge';
import { DoiChip } from './DoiChip';
import { getOverride, getSharedOverride, fetchSharedOverrides, getUseCommunityOverrides } from '../matchOverrides';

// dblp's own <ee> element(s) -- usually a DOI link, but a record can carry
// several (e.g. also an arXiv mirror) and a repeated field comes back as an
// array rather than a lone string (see admin.js's wireRecordParser) -- so
// this accepts either shape and returns the first entry that's actually a
// doi.org link, ready to use directly as an href.
function findDoiUrl(ee) {
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
// Only renders the row's *inner* content now -- the wrapping <li> (with its
// "year"/"entry <type>" className) moved to PublicationsItem below, since
// Virtuoso owns the wrapping element it measures for virtualization.
const PublicationRow = React.memo(function PublicationRow({ item, nr, pids, onOpenAuthor }) {
  const year = item.dblp.year;
  return (
    <>
      <Tooltip title={dblpCategories[item.type].name} placement="left">
        <div className="box">
          <img alt="paper" src="https://dblp.org/img/n.png" />
        </div>
      </Tooltip>
      <div className="nr">[{nr}]</div>
      <div className="rank">
      <RankBadge rank={item.rank} portal={item.type === 'inproceedings' ? 'core' : 'sjr'} year={year} resolvedFullName={item.fullName} />
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
        <Venue item={item} />
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

const PublicationsItem = React.forwardRef(function PublicationsItem({ item: row, children, style, ...props }, ref) {
  const className = row.kind === 'year' ? 'year' : `entry ${row.item.type}`;
  return <li className={className} ref={ref} style={style} {...props}>{children}</li>;
});

export function Publications({ author, data, onOpenAuthor, selfPids }) {
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
    const pubs = [...data].sort((a, b) => b.year - a.year);
    const typeCounts = data.reduce((acc, curr) => {
      acc[curr.type] = (acc[curr.type] || 0) + 1;
      return acc;
    }, {});
    let previousYear = null;
    const out = [];
    for (const item of pubs) {
      const displayYear = previousYear !== item.dblp.year;
      previousYear = item.dblp.year;
      if (displayYear) out.push({ kind: 'year', key: `year-${item.dblp.year}`, year: item.dblp.year });
      const nr = dblpCategories[item.type].letter + typeCounts[item.type]--;
      out.push({ kind: 'entry', key: item.dblp.url, item, nr });
    }
    return out;
  }, [data]);

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
      initialItemCount={30}
      data={rows}
      computeItemKey={(index, row) => row.key}
      components={{ List: PublicationsList, Item: PublicationsItem }}
      itemContent={(index, row) => row.kind === 'year'
        ? row.year
        : <PublicationRow item={row.item} nr={row.nr} pids={pids} onOpenAuthor={onOpenAuthor} />}
    />
  );
}

function Venue({ item }) {
  let link;
  let extra;

  const { type, venue: rawVenue, dblp: { pages, volume, number, year, journal, publisher, isbn, ee } = {} } = item || {};
  const doiUrl = findDoiUrl(ee);
  const portal = type === 'inproceedings' ? 'core' : 'sjr';

  // Mirrors RankBadge's own override lookup (personal wins over shared) so
  // that correcting a match here -- via the rank badge's popover -- also
  // updates the venue name shown right next to it, instead of leaving the
  // old (wrong) name displayed under a now-corrected rank.
  const [sharedMap, setSharedMap] = useState(null);
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    if (!getUseCommunityOverrides()) return;
    let cancelled = false;
    fetchSharedOverrides(portal).then(m => { if (!cancelled) setSharedMap(m); });
    return () => { cancelled = true; };
  }, [portal]);

  useEffect(() => {
    const onChange = () => forceRefresh(t => t + 1);
    window.addEventListener('rankme:overridechange', onChange);
    return () => window.removeEventListener('rankme:overridechange', onChange);
  }, []);

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
  // and dblp's own raw text as the last resort.
  const venue = withAcronym(overrideCandidate?.title, overrideCandidate?.acronym)
    || withAcronym(item.rank?.matchedTitle, item.rank?.matchedAcronym)
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
