// React
import React, { useState, useEffect, useMemo } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

// Chart.js Components
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';

// DBLP
import { fetchAuthor } from '../dblp';
import { useRankedPublications } from '../useRankedPublications';
import { ranks, useFilterSettings } from '../FilterSettingsContext';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { RanksByYearChart } from './Statistics';
import { RankSummary } from './RankSummary';
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
  const { filterRanks, filterCategoriesDblp } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    setFilteredRecords(filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories: filterCategoriesDblp, filterRanks }));
  }, [rankedPublications, filterYears, filterCategoriesDblp, filterRanks]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  return (
    <div className='App'>
      <div style={{ position: 'relative', textAlign: 'center', marginTop: '40px', padding: '0 160px' }}>
        <h1>Records of {trimLastDigits(author.name)}</h1>
        <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
          {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${rankedPublications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
        </div>
        <div style={{ position: 'absolute', top: 0, right: '20px' }}>
          <FilterButton isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', margin: '30px 0 40px 0' }}>
        <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} />
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

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



