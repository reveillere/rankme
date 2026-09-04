// React
import React, { useState, useEffect, useMemo } from 'react';

// Material-UI Components and Icons
import { Tab, Tabs } from '@mui/material';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

// Chart.js Components
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';

// DBLP and CorePortal
import { dblpCategories, fetchAuthor } from '../dblp';
import * as CorePortal from '../corePortal';
import * as SjrPortal from '../sjrPortal';
import { useRankedPublications } from '../useRankedPublications';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { CategoriesPieChart, RanksPieChart, CategoriesByYearChart, RanksByYearChart } from './Statistics';
import { RankSelector, CategoriesSelector } from './Selector';
import { FilterButton } from './FilterButton';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';

// Utilities and Styles
import { trimLastDigits } from '../utils';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

Chart.register(ArcElement, LinearScale, BarController, BarElement, CategoryScale, Tooltip);

export function Author({ pid, onOpenAuthor }) {
  const [author, setAuthor] = useState(null);

  useEffect(() => {
    const fetchData = async function () {
      try {
        const author = await fetchAuthor(pid);
        setAuthor(author)
      } catch (e) {
        console.error(`Error fetching data for author ${pid}: `, e);
      }
    };
    fetchData();
  }, [pid]);

  if (author === null)
    return <LoadingSpinner />;

  return <AuthorShow author={author?.dblpperson?.$} pid={pid} onOpenAuthor={onOpenAuthor} />;
}




function AuthorShow({ author, pid, onOpenAuthor }) {
  const { publications: rankedPublications, progress, done, failed } = useRankedPublications(`/api/dblp/author-stream/${pid}`);

  if (failed && rankedPublications === null)
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this author from DBLP. Please try again later.</div>;

  if (rankedPublications === null)
    return <LoadingSpinner />;

  return <AuthorContent author={author} publications={rankedPublications} progress={progress} done={done} onOpenAuthor={onOpenAuthor} />;
}




const yearAccessor = pub => pub.dblp.year;

function AuthorContent({ author, publications: rankedPublications, progress, done, onOpenAuthor }) {
  // Years are already known from the initial SSE `init` payload — only
  // `.rank` fields arrive later — so this only needs recomputing when the
  // publication count itself changes, not on every streamed rank update
  // (which replaces the array reference on every tick).
  const [minYear, maxYear] = useMemo(
    () => [Math.min(...rankedPublications.map(yearAccessor)), Math.max(...rankedPublications.map(yearAccessor))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rankedPublications.length]
  );
  const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
  const [tabGraph, setTabGraph] = useState(0);
  const [tabSelect, setTabSelect] = useState(0);
  const [filterCategories, setFilterCategories] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
  const [filterRanks, setFilterRanks] = React.useState({
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

  const handleTabGraph = (event, newValue) => {
    setTabGraph(newValue);
  };

  const handleTabSelect = (event, newValue) => {
    setTabSelect(newValue);
  };

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  const ranks = { ...CorePortal.ranks, ...SjrPortal.ranks };

  return (
    <div className='App'>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {isFilterActive || <div style={{ marginLeft: '50px', marginRight: '100px', marginTop: '40px' }}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />
        </div>}

        <div id='foo' style={{ textAlign: 'center' }}>
          <h1>Records of {trimLastDigits(author.name)}</h1>
          <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
            {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${rankedPublications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
          </div>
        </div>

        <div style={{ marginLeft: '100px', marginTop: '40px' }}>
          <FilterButton isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} />
        </div>

      </div>

      {isFilterActive &&

<>
<div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0', height: '250px', boxSizing: 'border-box', overflow: 'hidden'  }}>
  <div style={{ width: '45%', display: 'flex', flexDirection: 'column', alignItems: 'center', boxSizing: 'border-box' }}>
    <Tabs value={tabGraph} onChange={handleTabGraph} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
      <Tab label="Stats by year" />
      <Tab label="Stats by type" />
    </Tabs>
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {tabGraph === 0 && tabSelect === 0 && <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />}
      {tabGraph === 0 && tabSelect === 1 && <CategoriesByYearChart records={filteredRecords} selected={filterCategories} categories={dblpCategories} yearAccessor={yearAccessor} />}

      {tabGraph === 1 && tabSelect === 0 && <RanksPieChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}
      {tabGraph === 1 && tabSelect === 1 && <CategoriesPieChart records={filteredRecords} selected={filterCategories} categories={dblpCategories} />}
    </div>
  </div>
  <div style={{ width: '45%', display: 'flex', flexDirection: 'column', marginLeft: '10%', alignItems: 'center', boxSizing: 'border-box' }}>
    <Tabs value={tabSelect} onChange={handleTabSelect} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
      <Tab label="Ranks" />
      <Tab label="Categories" />
    </Tabs>
    {tabSelect === 0 && <RankSelector records={filteredRecords} selected={filterRanks} setSelected={setFilterRanks} />}
    {tabSelect === 1 && <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} categories={dblpCategories} />}
  </div>
</div>
<DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />
</>

      }

      <div style={{ height: '50px' }}></div>
      <Publications author={author} data={filteredRecords} onOpenAuthor={onOpenAuthor} />

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        open={!done}
      >
        <Alert severity="info" sx={{ width: '100%' }}>
          Update in progress ({updateCompletedPercent}%)
        </Alert>
      </Snackbar>

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
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



