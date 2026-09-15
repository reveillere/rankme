import React, { useState, useEffect, useMemo } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

import { useRankedPublications } from '../useRankedPublications';
import { rankingQueryParams, customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import DateRangeSlider from './DateRangeSlider';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { HalPublications } from './HalPublications';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { getEffectiveCustomValue, customProfileIdForPortal } from '../customRankings';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { getHalCategory } from '../hal';
import '../App.css';

const yearAccessor = pub => pub.year;
const categoryKeyAccessor = pub => getHalCategory(pub.type).cssClass;
const portalAccessor = pub => pub.type === 'COMM' ? 'core' : 'sjr';

// Lazy: pulls in chart.js (a meaningfully sized dependency) as its own
// chunk, since the chart renders below the fold rather than gating the
// initial view of this page.
const RanksByYearChart = React.lazy(() => import('./Statistics').then(m => ({ default: m.RanksByYearChart })));

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
export function Structure({ structId, structureName, onOpenAuthor, onSearchAuthor, onNameResolved, isActive }) {
  // Read from context, not localStorage directly -- see Author.js's
  // identical comment for why this is what makes switching sources live.
  const { conferenceSource, journalSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed, queued, queuePosition, memberIds } = useRankedPublications(`/api/hal/structure-stream/${structId}${rankingQueryParams({ conferenceSource, journalSource })}`);
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
      queued={queued}
      queuePosition={queuePosition}
      memberIds={memberIds}
      isActive={isActive}
    />
  );
}

function StructureContent({ structureName, onOpenAuthor, onSearchAuthor, publications: rankedPublications, progress, done, queued, queuePosition, memberIds, isActive }) {
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
  const { filterRanks, filterCategories, ranks, conferenceSource, journalSource } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // See Author.js's identical comment: stable unless a source actually
  // changes, so it doesn't defeat HalPublicationRow's React.memo.
  const activeCustomProfileIds = useMemo(
    () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
    [conferenceSource, journalSource]
  );
  // See Author.js's identical effectiveValueAccessor comment.
  const effectiveValueAccessor = pub => {
    if (!pub.rank) return undefined;
    const portal = portalAccessor(pub);
    const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
    if (!customProfileId) return pub.rank.value;
    return getEffectiveCustomValue(customProfileId, portal, pub.rank, getOverride(portal, pub.rank), yearAccessor(pub)).value;
  };
  // See Author.js's identical customProfileIdAccessor comment.
  const customProfileIdAccessor = pub => customProfileIdForPortal(activeCustomProfileIds, portalAccessor(pub));

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    const records = filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor, filterRanks, effectiveValueAccessor });
    const toReview = records.filter(pub => {
      const portal = portalAccessor(pub);
      return needsReview(portal, pub.rank, getSharedOverride(pub.rank, sharedMaps[portal]));
    });
    setReviewCount(toReview.length);
    setFilteredRecords(reviewOnly && toReview.length > 0 ? toReview : records);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedPublications, filterYears, filterCategories, filterRanks, reviewOnly, overrideTick, sharedMaps, activeCustomProfileIds]);

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
        <React.Suspense fallback={<CircularProgress size={32} />}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} sharedMaps={sharedMaps} customProfileIdAccessor={customProfileIdAccessor} />
        </React.Suspense>
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} sharedMaps={sharedMaps} customProfileIdAccessor={customProfileIdAccessor} yearAccessor={yearAccessor} />
      </div>

      <div style={{ margin: '0 0 20px 0' }}>
        <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      {/* memberIds: every idHal personally affiliated with this structure
          (not just a co-author on one of its papers -- see
          controllerHalStructure/structureMembersOf), so their name reads
          the same underlined way a Team's own members' names do. */}
      <HalPublications selfIds={memberIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} />

      <Snackbar anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} open={!done}>
        <Alert severity="info" sx={{ width: '100%' }}>
          {queued
            ? `Queued${queuePosition != null ? ` — ${queuePosition} ahead of you` : '…'}`
            : `Update in progress (${updateCompletedPercent}%)`}
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
