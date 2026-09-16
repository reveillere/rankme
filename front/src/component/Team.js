import React, { useState, useEffect, useMemo, useRef } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LinkIcon from '@mui/icons-material/Link';

import { useMergedRankedPublications } from '../useMergedRankedPublications';
import { getTeam } from '../teamStore';
import { exportDblpPublicationsMarkdown, exportHalPublicationsMarkdown, exportDblpPublicationsJson, exportHalPublicationsJson, exportDblpPublicationsCsv, exportHalPublicationsCsv } from '../exportPublications';
import { useFilterSettings } from '../FilterSettingsContext';
import { getHalCategory } from '../hal';
import { customProfileIdFrom } from '../rankingSource';

// Components
import DateRangeSlider from './DateRangeSlider';
import { MemberListDialog } from './MemberListDialog';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { Publications } from './Publications';
import { HalPublications } from './HalPublications';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { SortButton } from './SortButton';
import { ExportButton } from './ExportButton';
import { RecordsHeader } from './RecordsHeader';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { getEffectiveCustomValue, customProfileIdForPortal } from '../customRankings';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { SORT_MODES, DEFAULT_SORT_MODE } from '../rankOrder';

import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

// Lazy: pulls in chart.js (a meaningfully sized dependency) as its own
// chunk, since the chart renders below the fold rather than gating the
// initial view of this page.
const RanksByYearChart = React.lazy(() => import('./Statistics').then(m => ({ default: m.RanksByYearChart })));

const yearAccessorFor = source => (source === 'hal' ? (pub => pub.year) : (pub => pub.dblp.year));
// HAL's own type codes aren't the shared category vocabulary — cssClass
// maps each one to its dblp-bucket equivalent (see filterPublications.js).
const categoryKeyAccessorFor = source => (source === 'hal' ? (pub => getHalCategory(pub.type).cssClass) : (pub => pub.type));
const portalAccessorFor = source => (source === 'hal' ? (pub => pub.type === 'COMM' ? 'core' : 'sjr') : (pub => pub.type === 'inproceedings' ? 'core' : 'sjr'));

export function Team({ teamId, onOpenAuthor, onSearchAuthor, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  const team = getTeam(teamId);

  if (!team) {
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>This team no longer exists.</div>;
  }

  return <TeamShow team={team} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} isActive={isActive} initialYearRange={initialYearRange} onYearRangeChange={onYearRangeChange} initialSort={initialSort} onSortChange={onSortChange} initialExport={initialExport} />;
}

function TeamShow({ team, onOpenAuthor, onSearchAuthor, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  // Read from context, not localStorage directly -- see Author.js's
  // identical comment for why this is what makes switching sources live
  // (passed through to the hook below, which needs them in its own effect's
  // dependency array to actually re-open every member's stream).
  const { conferenceSource, journalSource } = useFilterSettings();
  const { publications: rankedPublications, progress, done, failed, queued, queuePosition } = useMergedRankedPublications(team.source, team.members, conferenceSource, journalSource);

  if (failed)
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this team&apos;s members from {team.source === 'hal' ? 'HAL' : 'DBLP'}. Please try again later.</div>;

  if (rankedPublications === null)
    return <LoadingSpinner message={progress.total > 0 ? `Computing ranks for ${team.members.length} members…` : `Loading publications for ${team.members.length} members…`} progress={progress} />;

  return (
    <TeamContent
      team={team}
      publications={rankedPublications}
      progress={progress}
      done={done}
      queued={queued}
      queuePosition={queuePosition}
      onOpenAuthor={onOpenAuthor}
      onSearchAuthor={onSearchAuthor}
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
// (CrossCheckTeam.js), same reasoning as Author.js's own handleCrossCheckConfirm.
// Unlike Author.js, there's no CrossCheckDialog step first: a team has no
// single identity to pick up front, resolution happens automatically per
// member on the server (see api/src/crosscheckTeam.js), so the button jumps
// straight to the report tab -- for either team source, crosscheckTeam.js
// now resolves both directions (see its own resolveDblpSourcedMember/
// resolveHalSourcedMember), so this same handler works regardless of
// team.source; only the button's own label differs below.
function handleCrossCheckTeam(team, onOpenAuthor) {
  onOpenAuthor({ type: 'crosscheck-team', id: `crosscheck-team:${team.id}`, teamId: team.id, label: `Cross-check: ${team.name}` });
}

function TeamContent({ team, publications: rankedPublications, progress, done, queued, queuePosition, onOpenAuthor, onSearchAuthor, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  const isHal = team.source === 'hal';
  const yearAccessor = useMemo(() => yearAccessorFor(team.source), [team.source]);
  const categoryKeyAccessor = useMemo(() => categoryKeyAccessorFor(team.source), [team.source]);
  const portalAccessor = useMemo(() => portalAccessorFor(team.source), [team.source]);
  const selfIds = useMemo(() => team.members.map(m => m.id), [team]);
  const identityMembers = useMemo(() => team.members.map(member => ({ id: member.id, name: member.label })), [team.members]);
  const dialogMembers = useMemo(() => team.members.map(m => ({ id: m.id, label: m.label, idKind: isHal ? 'idHal' : 'pid' })), [team.members, isHal]);
  // Client-side id->name lookup for IdentityLinksPanel.js's own display --
  // GET /api/identity/links never returns a name (see that panel's own
  // comment), but a team member's own resolved `label` (set from a search
  // result -- see Teams.js's addMember) is already sitting right here, no
  // extra request needed.
  const resolveMemberName = useMemo(() => {
    const byId = new Map(team.members.filter(m => m.label && m.label !== m.id).map(m => [m.id, m.label]));
    return id => byId.get(id);
  }, [team.members]);

  const [minYear, maxYear] = useMemo(() => {
    const knownYears = rankedPublications.map(yearAccessor).filter(year => year != null);
    const currentYear = new Date().getFullYear();
    if (knownYears.length === 0) return [currentYear, currentYear];
    return [Math.min(...knownYears), Math.max(...knownYears)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedPublications.length, team.source]);
  // initialYearRange comes from the tab's own ?from=&to= (see App.js's
  // tabFromPath) -- applied only here, at this component's first mount
  // (tabs stay mounted forever, see App.js's display:none/block comment, so
  // there's no later remount to re-apply a changed prop on).
  const validInitialYearRange = Array.isArray(initialYearRange) && initialYearRange.length === 2
    && Number.isFinite(initialYearRange[0]) && Number.isFinite(initialYearRange[1]) && initialYearRange[0] <= initialYearRange[1]
    ? [Math.max(minYear, Math.min(initialYearRange[0], maxYear)), Math.max(minYear, Math.min(initialYearRange[1], maxYear))]
    : null;
  const [filterYears, setFilterYears] = React.useState(() => validInitialYearRange || [minYear, maxYear]);
  // See Author.js's identical sortMode comment: drives Publications.js/
  // HalPublications.js's own grouping/ordering below, exposed here (not
  // buried inside either) so a future sort-aware export can read it.
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
  // changes, so it doesn't defeat Publications.js/HalPublications.js's own
  // row-level React.memo.
  const activeCustomProfileIds = useMemo(
    () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
    [conferenceSource, journalSource]
  );
  // See Author.js's identical effectiveValueAccessor comment -- portalAccessor
  // here is itself already memoized on team.source (above), so this only
  // needs its own on top of that plus activeCustomProfileIds.
  const effectiveValueAccessor = useMemo(() => (pub) => {
    if (!pub.rank) return undefined;
    const portal = portalAccessor(pub);
    const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
    if (!customProfileId) return pub.rank.value;
    return getEffectiveCustomValue(customProfileId, portal, pub.rank, getOverride(portal, pub.rank), yearAccessor(pub)).value;
  }, [portalAccessor, yearAccessor, activeCustomProfileIds]);
  // See Author.js's identical customProfileIdAccessor comment.
  const customProfileIdAccessor = useMemo(
    () => (pub) => customProfileIdForPortal(activeCustomProfileIds, portalAccessor(pub)),
    [portalAccessor, activeCustomProfileIds]
  );

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
  }, [rankedPublications, filterYears, filterCategories, filterRanks, yearAccessor, categoryKeyAccessor, reviewOnly, portalAccessor, overrideTick, sharedMaps, effectiveValueAccessor]);

  // See Author.js's identical effect for why this is one-shot (hasExportedRef,
  // not state) and declared after the filteredRecords-recomputing effect
  // above.
  const hasExportedRef = useRef(false);
  useEffect(() => {
    if (hasExportedRef.current || !initialExport) return;
    hasExportedRef.current = true;
    const filenameBase = `${isHal ? 'hal' : 'dblp'}-team-${team.name.replace(/\s+/g, '-').toLowerCase()}`;
    const exportTitle = `${isHal ? 'HAL' : 'DBLP'} records of ${team.name} (${team.members.length} members)`;
    if (initialExport === 'md') {
      (isHal ? exportHalPublicationsMarkdown : exportDblpPublicationsMarkdown)(filteredRecords, { title: exportTitle, filename: `${filenameBase}.md`, sortMode });
    } else if (initialExport === 'json') {
      (isHal ? exportHalPublicationsJson : exportDblpPublicationsJson)(filteredRecords, { title: exportTitle, filename: `${filenameBase}.json`, sortMode });
    } else if (initialExport === 'csv') {
      (isHal ? exportHalPublicationsCsv : exportDblpPublicationsCsv)(filteredRecords, { filename: `${filenameBase}.csv`, sortMode });
    }
  }, [initialExport, filteredRecords, sortMode, isHal, team.name, team.members.length]);

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
      <RecordsHeader
        title={<>{isHal ? 'HAL' : 'DBLP'} records of {team.name}</>}
        details={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          Team of {team.members.length} members
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
        showing={publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} deduplicated records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        exportButton={<ExportButton
          onExportMarkdown={() => (isHal
            ? exportHalPublicationsMarkdown(filteredRecords, { title: `HAL records of ${team.name} (${team.members.length} members)`, filename: `hal-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.md`, sortMode })
            : exportDblpPublicationsMarkdown(filteredRecords, { title: `DBLP records of ${team.name} (${team.members.length} members)`, filename: `dblp-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.md`, sortMode })
          )}
          onExportJson={() => (isHal
            ? exportHalPublicationsJson(filteredRecords, { title: `HAL records of ${team.name} (${team.members.length} members)`, filename: `hal-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.json`, sortMode })
            : exportDblpPublicationsJson(filteredRecords, { title: `DBLP records of ${team.name} (${team.members.length} members)`, filename: `dblp-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.json`, sortMode })
          )}
          onExportCsv={() => (isHal
            ? exportHalPublicationsCsv(filteredRecords, { filename: `hal-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.csv`, sortMode })
            : exportDblpPublicationsCsv(filteredRecords, { filename: `dblp-team-${team.name.replace(/\s+/g, '-').toLowerCase()}.csv`, sortMode })
          )}
        />}
      />

      <MemberListDialog
        open={membersDialogOpen}
        onClose={() => setMembersDialogOpen(false)}
        title={`Members of ${team.name} (${team.members.length})`}
        members={dialogMembers}
      />

      {/* A dblp-sourced team's own member ids ARE dblp pids (search by
          pids), a hal-sourced team's are idHals (search by idHals) --
          selfIds already carries whichever one team.source made it, see its
          own useMemo above. */}
      <IdentityLinksPanel
        open={linksPanelOpen}
        onClose={() => setLinksPanelOpen(false)}
        idHals={isHal ? selfIds : []}
        pids={isHal ? [] : selfIds}
        resolveName={resolveMemberName}
        teamSource={team.source}
        teamMembers={identityMembers}
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
          onClick={() => handleCrossCheckTeam(team, onOpenAuthor)}
          sx={{ borderRadius: '20px', textTransform: 'none', fontWeight: 500, boxShadow: 'none' }}
        >
          Cross-check with {isHal ? 'DBLP' : 'HAL'}
        </Button>
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      {isHal
        ? <HalPublications selfIds={selfIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} sortMode={sortMode} />
        : <Publications data={filteredRecords} onOpenAuthor={onOpenAuthor} selfPids={selfIds} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} sortMode={sortMode} />}

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
