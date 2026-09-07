import React from 'react';
import Tooltip from '@mui/material/Tooltip';
import { getHalCategory } from '../hal';

// Extracted from AuthorHal.js so Team.js can reuse the exact same rendering
// for a HAL-sourced team, parameterized by selfIds (the whole team's HAL
// ids) instead of a single author's id.
export function HalPublications({ selfIds, data, onOpenAuthor, onSearchAuthor }) {
  const sorted = [...data].sort((a, b) => (b.year || 0) - (a.year || 0));
  let previousYear = null;

  return (
    <ul className='publ-list'>
      {sorted.map((item) => {
        const displayYear = previousYear !== item.year;
        previousYear = item.year;
        const category = getHalCategory(item.type);

        return (
          <React.Fragment key={item.docid}>
            {displayYear && <li className="year">{item.year || '?'}</li>}
            <li className={`entry ${category.cssClass}`}>
              <div className="box">
                <img alt="paper" src="https://dblp.org/img/n.png" />
              </div>
              <div className="rank">
                {item.rank && <Tooltip title={<div>{item.rank.msg}</div>} placement="bottom"><span>{item.rank.value}</span></Tooltip>}
              </div>
              <cite className='data'>
                {item.authors.length > 0
                  ? item.authors
                      .map((a, i) => (
                        <span key={i} className="link">
                          {a.idHal && selfIds.includes(a.idHal) ? (
                            a.name
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
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.venue || category.name}
                      </a>
                    ) : (
                      item.venue || category.name
                    )}
                  </span>
                </span>
              </cite>
            </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
}
