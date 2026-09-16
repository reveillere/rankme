import React, { useState, useEffect, useMemo, useRef } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';

import { useRankedPublications } from '../useRankedPublications';
import { rankingQueryParams, customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import DateRangeSlider from './DateRangeSlider';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { SortButton } from './SortButton';
import { ExportButton } from './ExportButton';
import { RecordsHeader } from './RecordsHeader';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { HalPublications } from './HalPublications';
import { IdentityLinkDialog } from './IdentityLinkDialog';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { getEffectiveCustomValue, customProfileIdForPortal } from '../customRankings';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { getHalCategory, fetchAuthorInfo } from '../hal';
import { exportHalPublicationsMarkdown, exportHalPublicationsJson, exportHalPublicationsCsv } from '../exportPublications';
import { fetchIdentitySuggestionForIdHal, postIdentityLink } from '../identityResolution';
import { SORT_MODES, DEFAULT_SORT_MODE } from '../rankOrder';
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

export function AuthorHal({ id, authorName, onOpenAuthor, onSearchAuthor, onNameResolved, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  // Read from context, not localStorage directly -- see Author.js's
  // identical comment for why this is what makes switching sources live.
  const { conferenceSource, journalSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed, queued, queuePosition } = useRankedPublications(`/api/hal/author-stream/${id}${rankingQueryParams({ conferenceSource, journalSource })}`);

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
      queued={queued}
      queuePosition={queuePosition}
      isActive={isActive}
      initialYearRange={initialYearRange}
      onYearRangeChange={onYearRangeChange}
      initialSort={initialSort}
      onSortChange={onSortChange}
      initialExport={initialExport}
    />
  );
}

function AuthorHalContent({ id, authorName, onOpenAuthor, onSearchAuthor, onNameResolved, publications: rankedPublications, progress, done, queued, queuePosition, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
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

  // idHal is already known (it's `id` itself) -- only the ORCID linkage
  // needs a network round trip, via HAL's own author referential rather
  // than derived from the publication list (see hal.js's getAuthorInfo).
  const [authorInfo, setAuthorInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setAuthorInfo(null);
    fetchAuthorInfo(id).then(info => { if (!cancelled) setAuthorInfo(info); });
    return () => { cancelled = true; };
  }, [id]);

  // Proposed DBLP identity for this idHal -- symmetric to Author.js's own
  // suggestedHalIdentity (a previously confirmed personLinks entry if one
  // exists, else a fresh ORCID match, else null; see
  // api/src/identityResolution.js's controllerSuggestDblpIdentity). Purely a
  // suggestion shown in the cross-check dialog below -- never applied
  // without the user picking it.
  const [suggestedDblpIdentity, setSuggestedDblpIdentity] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSuggestedDblpIdentity(null);
    fetchIdentitySuggestionForIdHal(id).then(info => { if (!cancelled) setSuggestedDblpIdentity(info); });
    return () => { cancelled = true; };
  }, [id]);
  const [crossCheckDialogOpen, setCrossCheckDialogOpen] = useState(false);

  // A personLinks-based suggestion (an already-confirmed link) never carries
  // a name -- controllerSuggestDblpIdentity only ever attaches one to a
  // fresh ORCID match (see identityResolution.js's own
  // resolveDblpIdentityForIdHal). This author's own name is known -- either
  // already resolved (`authorName`, patched up top by the effect just above
  // this component's own JSX) or, before that lands, found the exact same
  // way that effect does (this author's own name alongside their idHal in
  // the authors array of any of their own publications) -- and used to fill
  // that gap: IdentityLinkDialog then searches DBLP by name up front instead
  // of only pre-filling the manual-pid field, the same candidate resurfacing
  // as an ordinary ranked result. Keyed off `rankedPublications.length`, not
  // the array itself, same reasoning as minYear/maxYear just below (authors
  // are already complete in the initial `init` payload, only `.rank` arrives
  // later). Memoized so this doesn't rebuild into a fresh object -- and
  // retrigger IdentityLinkDialog's pre-fill effect (keyed on the
  // `suggestion` reference) -- on every unrelated re-render while the
  // dialog is open.
  const dblpSuggestion = useMemo(() => {
    if (!suggestedDblpIdentity || suggestedDblpIdentity.name) return suggestedDblpIdentity;
    const resolvedName = authorName || rankedPublications.flatMap(pub => pub.authors).find(a => a.idHal === id)?.name;
    return resolvedName ? { ...suggestedDblpIdentity, name: resolvedName } : suggestedDblpIdentity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedDblpIdentity, authorName, rankedPublications.length, id]);

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
  // initialYearRange comes from the tab's own ?from=&to= (see App.js's
  // tabFromPath) -- applied only here, at this component's first mount
  // (tabs stay mounted forever, see App.js's display:none/block comment, so
  // there's no later remount to re-apply a changed prop on).
  const validInitialYearRange = Array.isArray(initialYearRange) && initialYearRange.length === 2
    && Number.isFinite(initialYearRange[0]) && Number.isFinite(initialYearRange[1]) && initialYearRange[0] <= initialYearRange[1]
    ? [Math.max(minYear, Math.min(initialYearRange[0], maxYear)), Math.max(minYear, Math.min(initialYearRange[1], maxYear))]
    : null;
  const [filterYears, setFilterYears] = useState(() => validInitialYearRange || [minYear, maxYear]);
  // See Author.js's identical sortMode comment: drives HalPublications.js's
  // own grouping/ordering below, exposed here (not buried inside
  // HalPublications) so a future sort-aware export can read it directly.
  const [sortMode, setSortMode] = useState(() => SORT_MODES.includes(initialSort) ? initialSort : DEFAULT_SORT_MODE);
  const { filterRanks, filterCategories, ranks, conferenceSource, journalSource } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(() => validInitialYearRange !== null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // A stable reference -- `[id]` as an inline JSX prop is a brand new array
  // every render, which would defeat HalPublicationRow's React.memo for
  // every row on every render (see HalPublications.js).
  const selfIds = useMemo(() => [id], [id]);
  // See Author.js's identical comment: stable unless a source actually
  // changes, so it doesn't defeat HalPublicationRow's React.memo either.
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

  // Mirrors every filter change back up to App.js -- see Author.js's
  // identical comment.
  useEffect(() => {
    onYearRangeChange?.(isFilterActive ? filterYears : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYears, isFilterActive]);

  // See Author.js's identical comment.
  useEffect(() => {
    onSortChange?.(sortMode === DEFAULT_SORT_MODE ? undefined : sortMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

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

  // See Author.js's identical effect for why this is one-shot (hasExportedRef,
  // not state) and declared after the filteredRecords-recomputing effect
  // above.
  const hasExportedRef = useRef(false);
  useEffect(() => {
    if (hasExportedRef.current || !initialExport) return;
    hasExportedRef.current = true;
    const filenameBase = `hal-${id}`;
    if (initialExport === 'md') {
      exportHalPublicationsMarkdown(filteredRecords, { title: `HAL records${authorName ? ` of ${authorName}` : ''}`, filename: `${filenameBase}.md`, sortMode });
    } else if (initialExport === 'json') {
      exportHalPublicationsJson(filteredRecords, { title: `HAL records${authorName ? ` of ${authorName}` : ''}`, filename: `${filenameBase}.json`, sortMode });
    } else if (initialExport === 'csv') {
      exportHalPublicationsCsv(filteredRecords, { filename: `${filenameBase}.csv`, sortMode });
    }
  }, [initialExport, filteredRecords, sortMode, authorName, id]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  // Hiding the filter also clears it — otherwise the year range stays
  // narrowed behind the scenes while the button looks inactive again.
  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  // Symmetric to Author.js's own handleCrossCheckConfirm: opens the very
  // same 'crosscheck-author' tab type (CrossCheck.js doesn't care which side
  // -- DBLP or HAL -- initiated the (pid, halId) resolution), just reached
  // from the opposite direction. The currently active year range, same
  // reasoning as Author.js's own call.
  const handleCrossCheckConfirm = (pid) => {
    setCrossCheckDialogOpen(false);
    postIdentityLink({ idHal: id, pid }).catch(err => console.error('Failed to record identity link', err));
    onOpenAuthor({ type: 'crosscheck-author', id: `crosscheck:${pid}:${id}`, pid, halId: id, label: pid, yearRange: filterYears });
  };

  return (
    <div className='App'>
      <RecordsHeader
        title={<>HAL records{authorName ? ` of ${authorName}` : ''}</>}
        details={<>
          idHal: {id}
          {authorInfo && (authorInfo.orcid
            ? <> · ORCID: <a href={authorInfo.orcid} target="_blank" rel="noreferrer">{authorInfo.orcid.replace('https://orcid.org/', '')}</a></>
            : (
              <span style={{ color: '#b26a00', marginLeft: '0.6em' }}>
                <WarningAmberIcon fontSize="inherit" style={{ verticalAlign: 'text-bottom', marginRight: '0.2em' }} />
                No ORCID linked to this HAL account
              </span>
            ))}
        </>}
        showing={publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        exportButton={<ExportButton
          onExportMarkdown={() => exportHalPublicationsMarkdown(filteredRecords, { title: `HAL records${authorName ? ` of ${authorName}` : ''}`, filename: `hal-${id}.md`, sortMode })}
          onExportJson={() => exportHalPublicationsJson(filteredRecords, { title: `HAL records${authorName ? ` of ${authorName}` : ''}`, filename: `hal-${id}.json`, sortMode })}
          onExportCsv={() => exportHalPublicationsCsv(filteredRecords, { filename: `hal-${id}.csv`, sortMode })}
        />}
      />

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', margin: '30px 0 40px 0' }}>
        <React.Suspense fallback={<CircularProgress size={32} />}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} sharedMaps={sharedMaps} customProfileIdAccessor={customProfileIdAccessor} />
        </React.Suspense>
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} sharedMaps={sharedMaps} customProfileIdAccessor={customProfileIdAccessor} yearAccessor={yearAccessor} />
      </div>

      <div style={{ margin: '0 0 20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
        <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
        <SortButton sortMode={sortMode} setSortMode={setSortMode} />
        <Button
          variant="outlined"
          color="primary"
          size="small"
          startIcon={<CompareArrowsIcon />}
          onClick={() => setCrossCheckDialogOpen(true)}
          sx={{ borderRadius: '20px', textTransform: 'none', fontWeight: 500, boxShadow: 'none' }}
        >
          Cross-check with DBLP
        </Button>
      </div>

      <IdentityLinkDialog
        open={crossCheckDialogOpen}
        onClose={() => setCrossCheckDialogOpen(false)}
        onConfirm={handleCrossCheckConfirm}
        direction="dblp"
        title="Cross-check with DBLP"
        description="Find this author's DBLP identity to list HAL publications with no matching DBLP record."
        suggestion={dblpSuggestion}
      />

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      <HalPublications selfIds={selfIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} sortMode={sortMode} />

      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        open={!done}
      >
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
