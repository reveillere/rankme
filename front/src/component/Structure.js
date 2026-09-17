import React, { useState, useEffect, useMemo, useRef } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LinkIcon from '@mui/icons-material/Link';

import { useRankedPublications } from '../useRankedPublications';
import { rankingQueryParams, customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import DateRangeSlider from './DateRangeSlider';
import { MemberListDialog } from './MemberListDialog';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { SortButton } from './SortButton';
import { ExportButton } from './ExportButton';
import { RecordsHeader } from './RecordsHeader';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { HalPublications } from './HalPublications';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { getDisplayValue, customProfileIdForPortal } from '../customRankings';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { getHalCategory } from '../hal';
import { exportHalPublicationsMarkdown, exportHalPublicationsJson, exportHalPublicationsCsv } from '../exportPublications';
import { SORT_MODES, DEFAULT_SORT_MODE } from '../rankOrder';
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
export function Structure({ structId, structureName, onOpenAuthor, onSearchAuthor, onNameResolved, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
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
      structId={structId}
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
      initialYearRange={initialYearRange}
      onYearRangeChange={onYearRangeChange}
      initialSort={initialSort}
      onSortChange={onSortChange}
      initialExport={initialExport}
    />
  );
}

// Opens a new tab type (see App.js's tabPath/tabFromPath/render block)
// rather than a dialog/inline view -- the report itself does its own fetch
// (CrossCheckStructure.js), same reasoning as Team.js's own
// handleCrossCheckTeam. Unlike Team.js, there's no source==='dblp' guard
// needed: a HAL structure is always HAL-sourced, and there's no earlier
// identity-picking step either -- resolution happens automatically per
// member on the server (see api/src/crosscheckStructure.js), so the button
// jumps straight to the report tab.
function handleCrossCheckStructure(structId, structureName, onOpenAuthor) {
  onOpenAuthor({ type: 'crosscheck-structure', id: `crosscheck-structure:${structId}`, structId, structureName, label: `Cross-check: ${structureName || structId}` });
}

function StructureContent({ structId, structureName, onOpenAuthor, onSearchAuthor, publications: rankedPublications, progress, done, queued, queuePosition, memberIds, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  // memberIds is bare idHal strings (see useRankedPublications) -- unlike a
  // Team's own members, a HAL structure never carries a resolved name of its
  // own for this list, and resolving hundreds of names via a dedicated HAL
  // request isn't worth the extra load. Built client-side instead, for free,
  // from this structure's own publications: `authors` (parsed HAL data,
  // standard `{name, idHal}` shape) is already part of the initial SSE
  // `init` payload -- like `year` -- so this only needs recomputing when the
  // publication count itself changes, not on every streamed rank tick (see
  // minYear/maxYear's own comment just below for the identical reasoning).
  // First name observed for a given idHal wins -- same technique
  // identityResolution.js's own fetchMemberNames uses server-side, and
  // AuthorHalContent (AuthorHal.js) uses for a single author's own name.
  const memberNameById = useMemo(() => {
    const map = new Map();
    for (const pub of rankedPublications) {
      for (const author of pub.authors) {
        if (author.idHal && !map.has(author.idHal)) map.set(author.idHal, author.name);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedPublications.length]);
  const dialogMembers = useMemo(() => memberIds.map(id => ({ id, idKind: 'idHal', label: memberNameById.get(id) })), [memberIds, memberNameById]);
  // Same client-side lookup, handed to IdentityLinksPanel.js so it can show
  // names too -- see that panel's own comment for why GET /api/identity/links
  // itself never returns one.
  const resolveMemberName = useMemo(() => (id => memberNameById.get(id)), [memberNameById]);
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
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [linksPanelOpen, setLinksPanelOpen] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // See Author.js's identical comment: stable unless a source actually
  // changes, so it doesn't defeat HalPublicationRow's React.memo.
  const activeCustomProfileIds = useMemo(
    () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
    [conferenceSource, journalSource]
  );
  // See Author.js's identical effectiveValueAccessor comment/fix: delegates
  // to getDisplayValue so this can never drift from what RankBadge.js
  // actually shows.
  const effectiveValueAccessor = pub => {
    if (!pub.rank) return undefined;
    const portal = portalAccessor(pub);
    const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
    const override = getOverride(portal, pub.rank);
    return getDisplayValue(pub.rank, { portal, sharedMap: sharedMaps[portal], customProfileId, override, year: yearAccessor(pub) });
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
    const filenameBase = `hal-structure-${(structureName || 'structure').replace(/\s+/g, '-').toLowerCase()}`;
    if (initialExport === 'md') {
      exportHalPublicationsMarkdown(filteredRecords, { title: `HAL records${structureName ? ` of ${structureName}` : ''}`, filename: `${filenameBase}.md`, sortMode });
    } else if (initialExport === 'json') {
      exportHalPublicationsJson(filteredRecords, { title: `HAL records${structureName ? ` of ${structureName}` : ''}`, filename: `${filenameBase}.json`, sortMode });
    } else if (initialExport === 'csv') {
      exportHalPublicationsCsv(filteredRecords, { filename: `${filenameBase}.csv`, sortMode });
    }
  }, [initialExport, filteredRecords, sortMode, structureName]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  return (
    <div className='App'>
      <RecordsHeader
        title={<>HAL records{structureName ? ` of ${structureName}` : ''}</>}
        details={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          Structure of {memberIds.length} members
          <Tooltip title="View members">
            <IconButton size="small" onClick={() => setMembersDialogOpen(true)} aria-label="View members">
              <VisibilityIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Manage identity links">
            <IconButton size="small" onClick={() => setLinksPanelOpen(true)} aria-label="Manage identity links">
              <LinkIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </span>}
        showing={publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        exportButton={<ExportButton
          onExportMarkdown={() => exportHalPublicationsMarkdown(filteredRecords, { title: `HAL records${structureName ? ` of ${structureName}` : ''}`, filename: `hal-structure-${(structureName || 'structure').replace(/\s+/g, '-').toLowerCase()}.md`, sortMode })}
          onExportJson={() => exportHalPublicationsJson(filteredRecords, { title: `HAL records${structureName ? ` of ${structureName}` : ''}`, filename: `hal-structure-${(structureName || 'structure').replace(/\s+/g, '-').toLowerCase()}.json`, sortMode })}
          onExportCsv={() => exportHalPublicationsCsv(filteredRecords, { filename: `hal-structure-${(structureName || 'structure').replace(/\s+/g, '-').toLowerCase()}.csv`, sortMode })}
        />}
      />

      <MemberListDialog
        open={membersDialogOpen}
        onClose={() => setMembersDialogOpen(false)}
        title={`Members${structureName ? ` of ${structureName}` : ''} (${memberIds.length})`}
        members={dialogMembers}
      />

      {/* A HAL structure's own membership is always idHals -- see
          memberIds's own comment above. */}
      <IdentityLinksPanel
        open={linksPanelOpen}
        onClose={() => setLinksPanelOpen(false)}
        structId={structId}
        idHals={memberIds}
        resolveName={resolveMemberName}
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
          onClick={() => handleCrossCheckStructure(structId, structureName, onOpenAuthor)}
          sx={{ borderRadius: '20px', textTransform: 'none', fontWeight: 500, boxShadow: 'none' }}
        >
          Cross-check with DBLP
        </Button>
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      {/* memberIds: every idHal personally affiliated with this structure
          (not just a co-author on one of its papers -- see
          controllerHalStructure/structureMembersOf), so their name reads
          the same underlined way a Team's own members' names do. */}
      <HalPublications selfIds={memberIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} sortMode={sortMode} />

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
