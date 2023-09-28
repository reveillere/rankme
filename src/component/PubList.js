/* eslint-disable react/prop-types */
import { useParams } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { fetchAuthor, getPublications, getName, dblpCategories } from '../dblp';
import { Box, CircularProgress } from '@mui/material';
import '../App.css';
import { trimLastDigits } from '../utils'

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
                <div className="rank">
                    {item.rank}
                </div>
                <div className="box">
                <img alt="paper" src="https://dblp.org/img/n.png" />
                </div>
                <div className="nr">[{nr}]</div>
                <cite className='data'>
                  {
                    item.authors.length > 0
                      ? item.authors
                        .map((a, i) => (
                          <span key={i} className="author">
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
  return (
    <span className='venue'>
      {
        item.type === 'article' ? (
          <>
            {item.venue} {item.dblp.pages} ({item.year})
          </>
        ) : (
          <>
            {item.venue} {item.dblp.year} {item.dblp.pages}
          </>
        )
      }
    </span>
  )
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




