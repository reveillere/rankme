import React, { useEffect, useState } from 'react';
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

export function Publications({ author, data, onOpenAuthor, selfPids }) {
  const pids = selfPids || [author.pid];
  const pubs = [...data].sort((a, b) => b.year - a.year);
  const typeCounts = data.reduce((acc, curr) => {
    acc[curr.type] = (acc[curr.type] || 0) + 1;
    return acc;
  }, {});

  let previousYear = null;

  const title = (o) => {
    if (typeof o === 'object')
      return (<>
        <i>{o.i}</i>{o._}</>
      );
    return <>{o}</>;
  }


  return (
    <div>
      <ul className='publ-list'>
        {pubs.map((item) => {
          const year = item.dblp.year;
          const displayYear = previousYear !== year;
          previousYear = year;
          const nr = dblpCategories[item.type].letter + typeCounts[item.type]--;

          return (
            <React.Fragment key={item.dblp.url}>
              {displayYear && <li className="year">{year}</li>}
              <li className={`entry ${item.type}`}>
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
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
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










