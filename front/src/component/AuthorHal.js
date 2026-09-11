import React, { useState, useEffect, useMemo } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

import { useRankedPublications } from '../useRankedPublications';
import { rankingSourceQueryParam } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import DateRangeSlider from './DateRangeSlider';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { HalPublications } from './HalPublications';
import { filterPublications } from '../filterPublications';
import { needsReview, getSharedOverride } from '../matchOverrides';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { getHalCategory } from '../hal';
import '../App.css';

const yearAccessor = pub => pub.year;
// HAL's own type codes (ART, COMM, ...) aren't the shared category
// vocabulary — cssClass maps each one to its dblp-bucket equivalent.
const categoryKeyAccessor = pub => getHalCategory(pub.type).cssClass;
const portalAccessor = pub => pub.type === 'COMM' ? 'core' : 'sjr';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

// Lazy: pulls in chart.js (a meaningfully sized dependency) as its own
// chunk, since the chart renders below the fold rather than gating the
// initial view of this page.
const RanksByYearChart = React.lazy(() => import('./Statistics').then(m => ({ default: m.RanksByYearChart })));

export function AuthorHal({ id, authorName, onOpenAuthor, onSearchAuthor, onNameResolved, isActive }) {
  // Read from context, not localStorage directly -- see Author.js's
  // identical comment for why this is what makes switching sources live.
  const { rankingSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed } = useRankedPublications(`/api/hal/author-stream/${id}${rankingSourceQueryParam(rankingSource)}`);

  if (failed && rankedPublications === null) {
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this author from HAL. Please try again later.</div>;
  }

  if (rankedPublications === null) {
    // Before `init` arrives, progress.total is still 0 -- that gap is HAL
    // fetch time, not ranking, so "Computing ranks" would be misleading.
    return <LoadingSpinner message={progress.total > 0 ? 'Computing ranks…' : 'Loading publications from HAL…'} progress={progress} />;
  }

  return (
    <AuthorHalContent
      id={id}
      authorName={authorName}
      onOpenAuthor={onOpenAuthor}
      onSearchAuthor={onSearchAuthor}
      onNameResolved={onNameResolved}
      publications={rankedPublications}
      progress={progress}
      done={done}
      isActive={isActive}
    />
  );
}

function AuthorHalContent({ id, authorName, onOpenAuthor, onSearchAuthor, onNameResolved, publications: rankedPublications, progress, done, isActive }) {
  // A tab opened directly by id (or reloaded from a bare /hal/:id URL)
  // doesn't know this author's display name yet -- unlike a structure (see
  // Structure.js's structure-info lookup), HAL has no per-author name
  // endpoint, but every one of their own publications already lists their
  // own name alongside their idHal in its authors array (see hal.js's
  // parseAuthors), so it's resolved from data already being fetched anyway
  // instead of firing an extra request. `init`'s publications (year/authors
  // etc.) are already complete by the time this component mounts -- only
  // ranks are still pending -- so this only needs to run once, not on every
  // streamed rank update.
  useEffect(() => {
    if (authorName || !onNameResolved) return;
    const match = rankedPublications.flatMap(pub => pub.authors).find(a => a.idHal === id);
    if (match?.name) onNameResolved(match.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authorName]);

  // Unlike dblp, HAL records can be missing a year (incomplete metadata) —
  // exclude those from the min/max range so they don't turn it into NaN.
  // Years are already known from the initial SSE `init` payload -- only
  // `.rank` fields arrive later -- so this only needs recomputing when the
  // publication count itself changes, not on every streamed rank update
  // (which replaces the array reference on every tick, and this stream can
  // flush ~7x/second). A single reduce pass avoids Math.min/max(...array),
  // which risks a RangeError on very large arrays.
  const [minYear, maxYear] = useMemo(() => {
    const knownYears = rankedPublications.map(yearAccessor).filter(year => year != null);
    const currentYear = new Date().getFullYear();
    if (knownYears.length === 0) return [currentYear, currentYear];
    return knownYears.reduce(([min, max], year) => [Math.min(min, year), Math.max(max, year)], [knownYears[0], knownYears[0]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedPublications.length]);
  const [filterYears, setFilterYears] = useState([minYear, maxYear]);
  const { filterRanks, filterCategories, ranks } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // A stable reference -- `[id]` as an inline JSX prop is a brand new array
  // every render, which would defeat HalPublicationRow's React.memo for
  // every row on every render (see HalPublications.js).
  const selfIds = useMemo(() => [id], [id]);

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    const records = filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor, filterRanks });
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
        <h1>HAL records{authorName ? ` of ${authorName}` : ''}</h1>
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
      <HalPublications selfIds={selfIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} sharedMaps={sharedMaps} isActive={isActive} />

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
