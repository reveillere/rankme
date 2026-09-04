import React, { useState, useEffect } from 'react';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

import { getHalCategory, halCategories } from '../hal';
import * as CorePortal from '../corePortal';
import * as SjrPortal from '../sjrPortal';
import { useRankedPublications } from '../useRankedPublications';
import DateRangeSlider from './DateRangeSlider';
import { CategoriesPieChart, RanksPieChart, CategoriesByYearChart, RanksByYearChart } from './Statistics';
import { RankSelector, CategoriesSelector } from './Selector';
import { FilterButton } from './FilterButton';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import '../App.css';

const yearAccessor = pub => pub.year;

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

export function AuthorHal({ id, authorName, onOpenAuthor, onSearchAuthor }) {
  const { publications: rankedPublications, progress, done, failed } = useRankedPublications(`/api/hal/author-stream/${id}`);

  if (failed && rankedPublications === null) {
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this author from HAL. Please try again later.</div>;
  }

  if (rankedPublications === null) {
    return <LoadingSpinner />;
  }

  return (
    <AuthorHalContent
      id={id}
      authorName={authorName}
      onOpenAuthor={onOpenAuthor}
      onSearchAuthor={onSearchAuthor}
      publications={rankedPublications}
      progress={progress}
      done={done}
    />
  );
}

function AuthorHalContent({ id, authorName, onOpenAuthor, onSearchAuthor, publications: rankedPublications, progress, done }) {
  // Unlike dblp, HAL records can be missing a year (incomplete metadata) —
  // exclude those from the min/max range so they don't turn it into NaN.
  const knownYears = rankedPublications.map(yearAccessor).filter(year => year != null);
  const currentYear = new Date().getFullYear();
  const minYear = knownYears.length ? Math.min(...knownYears) : currentYear;
  const maxYear = knownYears.length ? Math.max(...knownYears) : currentYear;
  const [filterYears, setFilterYears] = useState([minYear, maxYear]);
  const [tabGraph, setTabGraph] = useState(0);
  const [tabSelect, setTabSelect] = useState(0);
  const [filterCategories, setFilterCategories] = useState(Object.keys(halCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
  const [filterRanks, setFilterRanks] = useState({
    ...Object.keys(CorePortal.ranks).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
    ...Object.keys(SjrPortal.ranks).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
  });
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    setFilteredRecords(filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, filterRanks }));
  }, [rankedPublications, filterYears, filterCategories, filterRanks]);

  const handleTabGraph = (event, newValue) => setTabGraph(newValue);
  const handleTabSelect = (event, newValue) => setTabSelect(newValue);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;
  const ranks = { ...CorePortal.ranks, ...SjrPortal.ranks };

  const sorted = [...filteredRecords].sort((a, b) => (b.year || 0) - (a.year || 0));
  let previousYear = null;

  return (
    <div className='App'>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {isFilterActive || <div style={{ marginLeft: '50px', marginRight: '100px', marginTop: '40px' }}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />
        </div>}

        <div style={{ textAlign: 'center' }}>
          <h1>HAL records{authorName ? ` of ${authorName}` : ''}</h1>
          <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
            {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${rankedPublications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
          </div>
        </div>

        <div style={{ marginLeft: '100px', marginTop: '40px' }}>
          <FilterButton isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} />
        </div>
      </div>

      {isFilterActive && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0', height: '250px', boxSizing: 'border-box', overflow: 'hidden' }}>
          <div style={{ width: '45%', display: 'flex', flexDirection: 'column', alignItems: 'center', boxSizing: 'border-box' }}>
            <Tabs value={tabGraph} onChange={handleTabGraph} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
              <Tab label="Stats by year" />
              <Tab label="Stats by type" />
            </Tabs>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              {tabGraph === 0 && tabSelect === 0 && <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />}
              {tabGraph === 0 && tabSelect === 1 && <CategoriesByYearChart records={filteredRecords} selected={filterCategories} categories={halCategories} yearAccessor={yearAccessor} />}

              {tabGraph === 1 && tabSelect === 0 && <RanksPieChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}
              {tabGraph === 1 && tabSelect === 1 && <CategoriesPieChart records={filteredRecords} selected={filterCategories} categories={halCategories} />}
            </div>
          </div>
          <div style={{ width: '45%', display: 'flex', flexDirection: 'column', marginLeft: '10%', alignItems: 'center', boxSizing: 'border-box' }}>
            <Tabs value={tabSelect} onChange={handleTabSelect} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
              <Tab label="Ranks" />
              <Tab label="Categories" />
            </Tabs>
            {tabSelect === 0 && <RankSelector records={filteredRecords} selected={filterRanks} setSelected={setFilterRanks} />}
            {tabSelect === 1 && <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} categories={halCategories} />}
          </div>
        </div>
        <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />
      </>}

      <div style={{ height: '50px' }}></div>

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
                            {a.idHal && a.idHal === id ? (
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

      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        open={!done}
      >
        <Alert severity="info" sx={{ width: '100%' }}>
          Update in progress ({updateCompletedPercent}%)
        </Alert>
      </Snackbar>

      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        open={showCompleted}
        onClose={() => setShowCompleted(false)}
        autoHideDuration={3000}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Update completed!
        </Alert>
      </Snackbar>
    </div>
  );
}
