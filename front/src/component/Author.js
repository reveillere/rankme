// React
import React, { useState, useEffect, useMemo } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

// DBLP
import { fetchAuthor } from '../dblp';
import { useRankedPublications } from '../useRankedPublications';
import { rankingSourceQueryParam } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import { needsReview, getSharedOverride } from '../matchOverrides';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';

// Utilities and Styles
import { trimLastDigits } from '../utils';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

// Lazy: pulls in chart.js (a meaningfully sized dependency) as its own
// chunk, since the chart renders below the fold rather than gating the
// initial view of this page.
const RanksByYearChart = React.lazy(() => import('./Statistics').then(m => ({ default: m.RanksByYearChart })));

export function Author({ pid, onOpenAuthor, onNameResolved, isActive }) {
  const [author, setAuthor] = useState(null);

  useEffect(() => {
    const fetchData = async function () {
      try {
        const author = await fetchAuthor(pid);
        setAuthor(author)
        // A tab opened directly by pid (or reloaded from a bare /dblp/:pid
        // URL) doesn't know this author's display name yet -- patch it in
        // once dblp's own record for them resolves, same as Structure.js
        // does for a structure's name.
        const name = author?.dblpperson?.$?.name;
        if (name) onNameResolved?.(trimLastDigits(name));
      } catch (e) {
        console.error(`Error fetching data for author ${pid}: `, e);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  if (author === null)
    return <LoadingSpinner message="Fetching author from DBLP…" />;

  return <AuthorShow author={author?.dblpperson?.$} pid={pid} onOpenAuthor={onOpenAuthor} isActive={isActive} />;
}




function AuthorShow({ author, pid, onOpenAuthor, isActive }) {
  // Read from context (not localStorage directly): switching ranking
  // source re-renders this with a new rankingSource value, which produces
  // a new streamUrl string below -- useRankedPublications' own effect
  // depends on that string, so it tears down and re-opens the stream with
  // the new source automatically, no page reload needed.
  const { rankingSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed } = useRankedPublications(`/api/dblp/author-stream/${pid}${rankingSourceQueryParam(rankingSource)}`);

  if (failed && rankedPublications === null)
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this author from DBLP. Please try again later.</div>;

  if (rankedPublications === null)
    return <LoadingSpinner message="Computing ranks…" progress={progress} />;

  return <AuthorContent author={author} publications={rankedPublications} progress={progress} done={done} onOpenAuthor={onOpenAuthor} isActive={isActive} />;
}




const yearAccessor = pub => pub.dblp.year;
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

function AuthorContent({ author, publications: rankedPublications, progress, done, onOpenAuthor, isActive }) {
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
  const { filterRanks, filterCategories, ranks } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    const records = filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, filterRanks });
    const toReview = records.filter(pub => {
      const portal = portalAccessor(pub);
      return needsReview(portal, pub.rank, getSharedOverride(pub.rank, sharedMaps[portal]));
    });
    setReviewCount(toReview.length);
    setFilteredRecords(reviewOnly && toReview.length > 0 ? toReview : records);
  }, [rankedPublications, filterYears, filterCategories, filterRanks, reviewOnly, overrideTick, sharedMaps]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  // Hiding the filter also clears it — otherwise the year range stays
  // narrowed behind the scenes while the button looks inactive again.
  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  return (
    <div className='App'>
      <div style={{ textAlign: 'center', marginTop: '40px', padding: '0 160px' }}>
        <h1>DBLP records of {trimLastDigits(author.name)}</h1>
        <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
          {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', margin: '30px 0 40px 0' }}>
        <React.Suspense fallback={<CircularProgress size={32} />}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} sharedMaps={sharedMaps} />
        </React.Suspense>
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} sharedMaps={sharedMaps} />
      </div>

      <div style={{ margin: '0 0 20px 0' }}>
        <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>
      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      <Publications author={author} data={filteredRecords} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} isActive={isActive} />

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



