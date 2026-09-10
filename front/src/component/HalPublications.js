import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import Tooltip from '@mui/material/Tooltip';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getHalCategory } from '../hal';
import { RankBadge } from './RankBadge';
import { DoiChip } from './DoiChip';

// A large structure (LaBRI: ~10,400 publications) re-flushes `data` on a
// timer while ranks stream in (see useRankedPublications.js) -- each flush
// only actually changes a handful of items (whichever ranks just arrived),
// but every *other* item keeps the exact same object reference (the flush
// mutates in place, see that hook's own comment). Without memoizing the
// row itself, React still re-executes every single row's render function
// on every flush regardless -- measured at 300ms-1.5s per flush for the
// full list, entirely on the main thread, which is what actually froze the
// tab (not just how often it happened). React.memo here means only the
// rows whose `item` reference actually changed do any work; a flush that
// updates 5 ranks out of 10,400 costs roughly 5 rows' worth of rendering,
// not 10,400.
//
// Only renders the row's *inner* content now -- the wrapping <li> (with its
// "year"/"entry <category>" className) moved to HalItem below, since
// Virtuoso owns the wrapping element it measures for virtualization.
const HalPublicationRow = React.memo(function HalPublicationRow({ item, category, selfIds, onOpenAuthor, onSearchAuthor }) {
  return (
    <>
      <Tooltip title={category.name} placement="left">
        <div className="box">
          <img alt="paper" src="https://dblp.org/img/n.png" />
        </div>
      </Tooltip>
      <div className="rank">
        <RankBadge rank={item.rank} portal={item.type === 'COMM' ? 'core' : 'sjr'} year={item.year} />
      </div>
      <cite className='data'>
        {item.authors.length > 0
          ? item.authors
              .map((a, i) => (
                <span key={i} className="link">
                  {a.idHal && selfIds.includes(a.idHal) ? (
                    <span className="self-author">{a.name}</span>
                  ) : a.idHal ? (
                    <a href="#" onClick={(e) => {
                      e.preventDefault();
                      onOpenAuthor({ type: 'hal-author', id: `hal:${a.idHal}`, label: a.name, halId: a.idHal, authorName: a.name });
                    }}>
                      {a.name}
                    </a>
                  ) : (
                    <a href="#" onClick={(e) => { e.preventDefault(); onSearchAuthor('hal', a.name); }}>
                      {a.name}
                    </a>
                  )}
                </span>
              ))
              .reduce((prev, curr) => [prev, ', ', curr])
          : <span>No Authors Listed</span>}
        <br />
        <span className='title'>{item.title}</span>
        <span className='link'>
          <span className='venue'>
            {item.venue || category.name}
          </span>
          {item.url && (
            <Tooltip title="View on HAL" placement="bottom">
              <a href={item.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, verticalAlign: 'middle' }}>
                <OpenInNewIcon sx={{ fontSize: '0.9em' }} />
              </a>
            </Tooltip>
          )}
          <DoiChip url={item.doi ? `https://doi.org/${item.doi}` : null} />
        </span>
      </cite>
    </>
  );
});

// Virtuoso's `List`/`Item` overrides keep the virtualized list's DOM a
// plain <ul>/<li> tree -- same markup, same App.css selectors
// (ul.publ-list>li...) as before virtualization, just with only the
// currently-visible <li>s actually mounted. `row` is whatever `itemContent`
// was handed for that index (see the flattened `rows` built below) --
// HalItem needs it to pick the right className, a decision that used to
// live on the two sibling <li>s themselves before they were split into
// "wrapper owned by Virtuoso, content returned by itemContent".
const HalList = React.forwardRef(function HalList({ style, children, ...props }, ref) {
  return <ul className='publ-list' ref={ref} style={style} {...props}>{children}</ul>;
});

const HalItem = React.forwardRef(function HalItem({ item: row, children, style, ...props }, ref) {
  const className = row.kind === 'year' ? 'year' : `entry ${row.category.cssClass}`;
  return <li className={className} ref={ref} style={style} {...props}>{children}</li>;
});

// Extracted from AuthorHal.js so Team.js can reuse the exact same rendering
// for a HAL-sourced team, parameterized by selfIds (the whole team's HAL
// ids) instead of a single author's id. selfIds/onOpenAuthor/onSearchAuthor
// need to stay referentially stable across re-renders for HalPublicationRow's
// memoization above to actually pay off -- see Structure.js's NO_SELF_IDS.
export function HalPublications({ selfIds, data, onOpenAuthor, onSearchAuthor }) {
  // Flattened so each Virtuoso index is exactly one <li> (a "year" marker
  // or an "entry") -- this is what makes the LaBRI-scale (~10,400 rows)
  // first mount cheap: only the rows actually inside (or just outside) the
  // viewport are ever rendered, instead of all 10,400 at once. category is
  // precomputed here (not inside HalPublicationRow) so HalItem can read it
  // for the className without a second getHalCategory call per row; for a
  // known type getHalCategory returns the same cached object every time
  // (see hal.js), so this doesn't defeat HalPublicationRow's memoization
  // above -- the category reference stays stable across flushes just like
  // `item` does for an unchanged row.
  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => (b.year || 0) - (a.year || 0));
    let previousYear = null;
    const out = [];
    for (const item of sorted) {
      const displayYear = previousYear !== item.year;
      previousYear = item.year;
      if (displayYear) out.push({ kind: 'year', key: `year-${item.year}`, year: item.year });
      out.push({ kind: 'entry', key: item.docid, item, category: getHalCategory(item.type) });
    }
    return out;
  }, [data]);

  return (
    <Virtuoso
      // Virtuoso's own root div is the actual flex child of .App here (the
      // <ul class="publ-list"> it renders is nested one level inside it) --
      // .App is a flex column with align-items:center, so without an
      // explicit width that root shrink-to-fits based on whichever rows
      // Virtuoso currently has mounted, and can collapse to almost nothing
      // (e.g. during the gap before any row has mounted, or if the
      // currently-visible rows all happen to be short).
      style={{ width: '100%' }}
      useWindowScroll
      // Virtuoso's normal bootstrap renders one "probe" item, measures it
      // via ResizeObserver, then expands to fill the viewport -- that
      // measurement step needs a ResizeObserver callback to actually fire.
      // initialItemCount sidesteps it for the first paint by rendering a
      // fixed batch unconditionally (meant for SSR, where there's no layout
      // to measure yet either); real scrolling afterwards is driven by
      // scroll events, not ResizeObserver, and already works fine.
      initialItemCount={30}
      data={rows}
      computeItemKey={(index, row) => row.key}
      components={{ List: HalList, Item: HalItem }}
      itemContent={(index, row) => row.kind === 'year'
        ? (row.year || '?')
        : (
          <HalPublicationRow
            item={row.item}
            category={row.category}
            selfIds={selfIds}
            onOpenAuthor={onOpenAuthor}
            onSearchAuthor={onSearchAuthor}
          />
        )}
    />
  );
}
