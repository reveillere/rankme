/* eslint-disable react/prop-types */
import { useParams } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { fetchAuthor, getPublications, getName, dblpCategories } from '../dblp';
import { Box, CircularProgress } from '@mui/material';
import '../App.css';
import { trimLastDigits } from '../utils'
import Tooltip from '@mui/material/Tooltip';

export function Publications({ author, data }) {
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
        {pubs.map((item, index) => {
          const year = item.dblp.year;
          const displayYear = previousYear !== year;
          previousYear = year;
          const nr = dblpCategories[item.type].letter + typeCounts[item.type]--;

          return (
            <React.Fragment key={index}>
              {displayYear && <li className="year">{year}</li>}
              <li className={`entry ${item.type}`}>
                <div className="box">
                  <img alt="paper" src="https://dblp.org/img/n.png" />
                </div>
                <div className="nr">[{nr}]</div>
                <div className="rank">
                {item.rank && <Tooltip title={<div>{item.rank.msg}</div>} placement="bottom"><span>{item.rank.value}</span></Tooltip>}
                </div>
                <cite className='data'>
                  {
                    item.authors.length > 0
                      ? item.authors
                        .map((a, i) => (
                          <span key={i} className="link">
                            {a.$.pid !== author.pid ? (
                              <a href={`/author/${a.$.pid}`}>
                                {trimLastDigits(a._)}
                              </a>
                            ) : (
                              trimLastDigits(a._)
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
  
  const { type, venue, dblp: { pages, volume, number, year, journal, publisher, isbn } = {} } = item || {};

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
        {item.fullName ? 
          <a>
            <Tooltip title={<div>{item.fullName}</div>} placement="bottom">
              <span>{link}</span>
            </Tooltip>
          </a> 
          : 
          link
        }
         {extra}
      </span>
    </span>
  );
}






export function PubList(props) {
  const [author, setAuthor] = useState(null);

  const params = useParams()['*'];
  const pid = props.pid ? props.pid : params;

  useEffect(() => {
    fetchAuthor(pid)
      .then((author) => {
        setAuthor(author);
      })
      .catch((error) => {
        console.error('Error fetching last publications:', error);
      });
  }, [pid]);

  if (author === null) return (
    <Box style={{ display: 'flex', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>);

  const publications = getPublications(author);
  const wrap = code => (props.pid ? code : (<div className='App'>{code}</div>));
  const publ = (<div className='publ'>
    <h1>Publications of {getName(author)} </h1>
    <Publications data={publications} />
  </div>)
  return wrap(publ);
}




