import React, { useState, useEffect } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

import { useRankedPublications } from '../useRankedPublications';
import { ranks, useFilterSettings } from '../FilterSettingsContext';
import DateRangeSlider from './DateRangeSlider';
import { RanksByYearChart } from './Statistics';
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
const categoryKeyAccessor = pub => getHalCategory(pub.type).cssClass;
const portalAccessor = pub => pub.type === 'COMM' ? 'core' : 'sjr';
// A stable (never-changing) empty array -- a `[]` literal inline in JSX is
// a brand new reference every render, which would defeat HalPublicationRow's
// React.memo for every single row on every render (see HalPublications.js).
const NO_SELF_IDS = [];

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

// A HAL structure (lab, institution, team...) shown the exact same way as a
// single HAL author -- see AuthorHal.js, which this mirrors -- since it's
// still just a list of HAL publications ranked the same way, just pulled by
// structId instead of by an author's own idHal. structureName is only known
// when the tab was opened from a search result -- opened directly by id (or
// reloaded from a bare /structure/:id URL) it arrives undefined, so the name
// is looked up here instead of just falling back to showing the raw id.
export function Structure({ structId, structureName, onOpenAuthor, onSearchAuthor, onNameResolved }) {
  const { publications: rankedPublications, progress, done, failed } = useRankedPublications(`/api/hal/structure-stream/${structId}`);
  const [resolvedName, setResolvedName] = useState(structureName);

  useEffect(() => {
    setResolvedName(structureName);
    if (structureName) return;
    let cancelled = false;
    fetch(`/api/hal/structure-info/${structId}`)
      .then(resp => (resp.ok ? resp.json() : null))
      .then(info => {
        if (cancelled || !info?.name) return;
        setResolvedName(info.name);
        onNameResolved?.(info.name);
      })
      .catch(() => { /* best-effort: falls back to showing the bare id */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structId, structureName]);

  if (failed && rankedPublications === null) {
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this structure from HAL. Please try again later.</div>;
  }

  if (rankedPublications === null) {
    // Before `init` arrives, progress.total is still 0 -- that gap is HAL
    // fetch time (can be a few seconds for a large structure), not ranking,
    // so "Computing ranks" would be misleading.
    return <LoadingSpinner message={progress.total > 0 ? 'Computing ranks…' : 'Loading publications from HAL…'} progress={progress} />;
  }

  return (
    <StructureContent
      structureName={resolvedName || structId}
      onOpenAuthor={onOpenAuthor}
      onSearchAuthor={onSearchAuthor}
      publications={rankedPublications}
      progress={progress}
      done={done}
    />
  );
}

function StructureContent({ structureName, onOpenAuthor, onSearchAuthor, publications: rankedPublications, progress, done }) {
  const knownYears = rankedPublications.map(yearAccessor).filter(year => year != null);
  const currentYear = new Date().getFullYear();
  const minYear = knownYears.length ? Math.min(...knownYears) : currentYear;
  const maxYear = knownYears.length ? Math.max(...knownYears) : currentYear;
  const [filterYears, setFilterYears] = useState([minYear, maxYear]);
  const { filterRanks, filterCategories } = useFilterSettings();
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

  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  return (
    <div className='App'>
      <div style={{ textAlign: 'center', marginTop: '40px', padding: '0 160px' }}>
        <h1>HAL records{structureName ? ` of ${structureName}` : ''}</h1>
        <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
          {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', margin: '30px 0 40px 0' }}>
        <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} />
      </div>

      <div style={{ margin: '0 0 20px 0' }}>
        <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      {/* A structure isn't a person, so no author in the list is ever
          "self" -- every author name is a clickable link, none underlined. */}
      <HalPublications selfIds={NO_SELF_IDS} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} />

      <Snackbar anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} open={!done}>
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
