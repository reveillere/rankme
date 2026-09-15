// React
import React, { useState, useEffect, useMemo } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

// DBLP
import { fetchAuthor } from '../dblp';
import { useRankedPublications } from '../useRankedPublications';
import { rankingQueryParams, customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { getEffectiveCustomValue, customProfileIdForPortal } from '../customRankings';
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
  // Read from context (not localStorage directly): switching either ranking
  // source re-renders this with new conferenceSource/journalSource values,
  // which produce a new streamUrl string below -- useRankedPublications'
  // own effect depends on that string, so it tears down and re-opens the
  // stream with the new source(s) automatically, no page reload needed.
  const { conferenceSource, journalSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed, queued, queuePosition } = useRankedPublications(`/api/dblp/author-stream/${pid}${rankingQueryParams({ conferenceSource, journalSource })}`);

  if (failed && rankedPublications === null)
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this author from DBLP. Please try again later.</div>;

  if (rankedPublications === null)
    return <LoadingSpinner message="Computing ranks…" progress={progress} />;

  return <AuthorContent author={author} publications={rankedPublications} progress={progress} done={done} queued={queued} queuePosition={queuePosition} onOpenAuthor={onOpenAuthor} isActive={isActive} />;
}




const yearAccessor = pub => pub.dblp.year;
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

function AuthorContent({ author, publications: rankedPublications, progress, done, queued, queuePosition, onOpenAuthor, isActive }) {
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
  const { filterRanks, filterCategories, ranks, conferenceSource, journalSource } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // Stable across renders unless a source actually changes -- see
  // Publications.js's PublicationRow, whose React.memo this would otherwise
  // defeat for every row on every render (same reasoning as `pids` above).
  const activeCustomProfileIds = useMemo(
    () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
    [conferenceSource, journalSource]
  );
  // Substitutes a custom ranking's own value in place of the raw automatic
  // match, but only for an axis that actually has a profile active
  // (customProfileIdForPortal) -- identical to pub.rank.value otherwise, so
  // filterPublications' filterRanks checkboxes behave exactly as before for
  // anyone not using a custom profile (see filterPublications.js's own
  // default parameter).
  const effectiveValueAccessor = pub => {
    if (!pub.rank) return undefined;
    const portal = portalAccessor(pub);
    const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
    if (!customProfileId) return pub.rank.value;
    return getEffectiveCustomValue(customProfileId, portal, pub.rank, getOverride(portal, pub.rank), yearAccessor(pub)).value;
  };
  // For RanksByYearChart/RankSummary: same type-based axis resolution as
  // effectiveValueAccessor above (portalAccessor never returns 'ccf'), not
  // portalFromRank(pub.rank) -- a CCF-*referenced* custom profile means a
  // CCF-sourced rank no longer implies "no custom profile active" the way
  // it used to (see customRankings.js's createProfile), so those two
  // components can no longer derive this themselves from the rank alone.
  const customProfileIdAccessor = pub => customProfileIdForPortal(activeCustomProfileIds, portalAccessor(pub));

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    const records = filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, filterRanks, effectiveValueAccessor });
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
      <Publications author={author} data={filteredRecords} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} />

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        open={!done}
      >
        <Alert severity="info" sx={{ width: '100%' }}>
          {queued
            ? `Queued${queuePosition != null ? ` — ${queuePosition} ahead of you` : '…'}`
            : `Update in progress (${updateCompletedPercent}%)`}
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



