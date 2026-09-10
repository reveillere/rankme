import React from 'react';
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
// This does NOT fix the very first mount (measured at ~6.4s of blocking
// main-thread work for the full 10,400-row list) or a filter that swaps in
// a very different subset (every row is "new" from React's point of view
// either way) -- only true list virtualization (rendering just the
// currently-visible rows) fixes those, and a react-virtuoso attempt was
// reverted here because its ResizeObserver-based measurement couldn't be
// verified to work at all in this project's browser test tooling. If the
// initial-load cost for an exceptionally large structure like LaBRI is
// still a problem, that's the next thing to tackle -- carefully, with a
// way to actually verify it first.
const HalPublicationRow = React.memo(function HalPublicationRow({ item, displayYear, selfIds, onOpenAuthor, onSearchAuthor }) {
  const category = getHalCategory(item.type);

  return (
    <React.Fragment>
      {displayYear && <li className="year">{item.year || '?'}</li>}
      <li className={`entry ${category.cssClass}`}>
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
      </li>
    </React.Fragment>
  );
});

// Extracted from AuthorHal.js so Team.js can reuse the exact same rendering
// for a HAL-sourced team, parameterized by selfIds (the whole team's HAL
// ids) instead of a single author's id. selfIds/onOpenAuthor/onSearchAuthor
// need to stay referentially stable across re-renders for HalPublicationRow's
// memoization above to actually pay off -- see Structure.js's NO_SELF_IDS.
export function HalPublications({ selfIds, data, onOpenAuthor, onSearchAuthor }) {
  const sorted = [...data].sort((a, b) => (b.year || 0) - (a.year || 0));
  let previousYear = null;

  return (
    <ul className='publ-list'>
      {sorted.map((item) => {
        const displayYear = previousYear !== item.year;
        previousYear = item.year;
        return (
          <HalPublicationRow
            key={item.docid}
            item={item}
            displayYear={displayYear}
            selfIds={selfIds}
            onOpenAuthor={onOpenAuthor}
            onSearchAuthor={onSearchAuthor}
          />
        );
      })}
    </ul>
  );
}
