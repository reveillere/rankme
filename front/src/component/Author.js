// React
import React, { useState, useEffect, useMemo, useRef } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

// DBLP
import { fetchAuthor, fetchAuthorInfo } from '../dblp';
import { useRankedPublications } from '../useRankedPublications';
import { rankingQueryParams, customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { SortButton } from './SortButton';
import { ExportButton } from './ExportButton';
import { RecordsHeader } from './RecordsHeader';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { CrossCheckDialog } from './CrossCheckDialog';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import { needsReview, getOverride, getSharedOverride } from '../matchOverrides';
import { fetchIdentitySuggestion, postIdentityLink } from '../identityResolution';
import { exportDblpPublicationsMarkdown, exportDblpPublicationsJson, exportDblpPublicationsCsv } from '../exportPublications';
import { getDisplayValue, customProfileIdForPortal } from '../customRankings';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { SORT_MODES, DEFAULT_SORT_MODE } from '../rankOrder';

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

export function Author({ pid, onOpenAuthor, onNameResolved, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
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

  return <AuthorShow author={author?.dblpperson?.$} pid={pid} onOpenAuthor={onOpenAuthor} isActive={isActive} initialYearRange={initialYearRange} onYearRangeChange={onYearRangeChange} initialSort={initialSort} onSortChange={onSortChange} initialExport={initialExport} />;
}




function AuthorShow({ author, pid, onOpenAuthor, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
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
    return <LoadingSpinner message="Loading publications from DBLP…" progress={progress} />;

  return <AuthorContent author={author} pid={pid} publications={rankedPublications} progress={progress} done={done} queued={queued} queuePosition={queuePosition} onOpenAuthor={onOpenAuthor} isActive={isActive} initialYearRange={initialYearRange} onYearRangeChange={onYearRangeChange} initialSort={initialSort} onSortChange={onSortChange} initialExport={initialExport} />;
}




const yearAccessor = pub => pub.dblp.year;
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

function AuthorContent({ author, pid, publications: rankedPublications, progress, done, queued, queuePosition, onOpenAuthor, isActive, initialYearRange, onYearRangeChange, initialSort, onSortChange, initialExport }) {
  // Years are already known from the initial SSE `init` payload — only
  // `.rank` fields arrive later — so this only needs recomputing when the
  // publication count itself changes, not on every streamed rank update
  // (which replaces the array reference on every tick).
  const [minYear, maxYear] = useMemo(
    () => [Math.min(...rankedPublications.map(yearAccessor)), Math.max(...rankedPublications.map(yearAccessor))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rankedPublications.length]
  );
  // initialYearRange comes from the tab's own ?from=&to= (see App.js's
  // tabFromPath) -- applied only here, at this component's first mount
  // (tabs stay mounted forever, see App.js's display:none/block comment, so
  // there's no later remount to re-apply a changed prop on; consistent with
  // e.g. onNameResolved above, which is likewise a one-shot from-URL seed).
  const validInitialYearRange = Array.isArray(initialYearRange) && initialYearRange.length === 2
    && Number.isFinite(initialYearRange[0]) && Number.isFinite(initialYearRange[1]) && initialYearRange[0] <= initialYearRange[1]
    ? [Math.max(minYear, Math.min(initialYearRange[0], maxYear)), Math.max(minYear, Math.min(initialYearRange[1], maxYear))]
    : null;
  const [filterYears, setFilterYears] = React.useState(() => validInitialYearRange || [minYear, maxYear]);
  // sortMode drives Publications.js's own grouping/ordering below (see its
  // `rows` useMemo) -- kept here, not buried inside Publications, so a
  // future "export respects the current sort" (see this feature's own scope
  // note) can read it directly off this component's state instead of having
  // to reach into Publications.js's internals.
  const [sortMode, setSortMode] = React.useState(() => SORT_MODES.includes(initialSort) ? initialSort : DEFAULT_SORT_MODE);
  const { filterRanks, filterCategories, ranks, conferenceSource, journalSource } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(() => validInitialYearRange !== null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const [crossCheckDialogOpen, setCrossCheckDialogOpen] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();
  // Passed to Publications as `selfPids` so this author's own name renders
  // underlined (not as a clickable link to themselves) wherever it appears
  // as a co-author -- Publications.js falls back to `[author?.pid]`
  // otherwise, but the `author` object here (dblp.js's controllerAuthor)
  // only ever carries `{ name }`, no `pid`, so that fallback never actually
  // matched anything. Stable across renders (same reasoning as
  // activeCustomProfileIds below) so it doesn't defeat PublicationRow's
  // React.memo for every row on every render.
  const selfPids = useMemo(() => [pid], [pid]);
  // Stable across renders unless a source actually changes -- see
  // Publications.js's PublicationRow, whose React.memo this would otherwise
  // defeat for every row on every render (same reasoning as `pids` above).
  const activeCustomProfileIds = useMemo(
    () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
    [conferenceSource, journalSource]
  );
  // The exact value RankBadge.js shows for this publication -- delegates
  // straight to getDisplayValue (personal override/community correction
  // when no custom profile is active on this axis, the custom profile's own
  // entry when one is) so the "filter by rank" checkboxes can never drift
  // from what's actually on screen. This used to fall back to the raw
  // pub.rank.value when no custom profile was active, silently ignoring a
  // personal/community correction -- a real inconsistency (a publication
  // corrected from B to A still showed up unchecked under "A" and checked
  // under "B"), not a deliberate simplification.
  const effectiveValueAccessor = pub => {
    if (!pub.rank) return undefined;
    const portal = portalAccessor(pub);
    const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
    const override = getOverride(portal, pub.rank);
    return getDisplayValue(pub.rank, { portal, sharedMap: sharedMaps[portal], customProfileId, override, year: yearAccessor(pub) });
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

  // Mirrors every filter change (slider moved, filter toggled on/off) back
  // up to App.js, which stashes it on the tab and reflects it into the URL
  // -- see tabPath/tabFromPath's ?from=&to= there. undefined (not
  // [minYear, maxYear]) when the filter is off, so tabPath omits the query
  // string entirely rather than encoding a range that means "unfiltered".
  useEffect(() => {
    onYearRangeChange?.(isFilterActive ? filterYears : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYears, isFilterActive]);

  // Mirrors the sort mode back up to App.js the same way -- undefined (not
  // 'date') when it's the default, so tabPath omits ?sort= entirely rather
  // than encoding a value that means "default".
  useEffect(() => {
    onSortChange?.(sortMode === DEFAULT_SORT_MODE ? undefined : sortMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

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

  // ?export=md/csv (see App.js's tabPath/tabFromPath) triggers the same
  // download the matching button below does, once, as soon as filteredRecords
  // reflects the URL's own ?from=&to=/?sort= (both already applied by the
  // time this runs -- initialYearRange/initialSort seed filterYears/sortMode
  // at mount, and this effect is declared after the one that recomputes
  // filteredRecords from them). hasExportedRef (not state) is what makes
  // this one-shot instead of re-downloading on every later filteredRecords
  // change (e.g. a streamed rank arriving) -- same guard-ref pattern as
  // CrossCheckTeam.js's own hasShownOnceRef for its popup.
  const hasExportedRef = useRef(false);
  useEffect(() => {
    if (hasExportedRef.current || !initialExport) return;
    hasExportedRef.current = true;
    const filenameBase = `dblp-${pid.replace(/\//g, '-')}`;
    if (initialExport === 'md') {
      exportDblpPublicationsMarkdown(filteredRecords, { title: `DBLP records of ${trimLastDigits(author.name)}`, filename: `${filenameBase}.md`, sortMode });
    } else if (initialExport === 'json') {
      exportDblpPublicationsJson(filteredRecords, { title: `DBLP records of ${trimLastDigits(author.name)}`, filename: `${filenameBase}.json`, sortMode });
    } else if (initialExport === 'csv') {
      exportDblpPublicationsCsv(filteredRecords, { filename: `${filenameBase}.csv`, sortMode });
    }
  }, [initialExport, filteredRecords, sortMode, author.name, pid]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  // Hiding the filter also clears it — otherwise the year range stays
  // narrowed behind the scenes while the button looks inactive again.
  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  // Opens a new tab type (see App.js's tabPath/tabFromPath/render block)
  // rather than a dialog/inline view -- the report itself does its own
  // fetch and can be sizeable for a prolific author, same reasoning as
  // every other "open a related thing" flow in this app (co-author links,
  // Search.js results, ...) going through onOpenAuthor.
  // pid is already known (it's `pid` itself) -- only the ORCID linkage needs
  // a network round trip, mirroring AuthorHal.js's identical authorInfo
  // fetch for the HAL side (see api/src/dblpLocal.js's getAuthorOrcid for
  // why this isn't a dedicated dblp field).
  const [authorInfo, setAuthorInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setAuthorInfo(null);
    fetchAuthorInfo(pid).then(info => { if (!cancelled) setAuthorInfo(info); });
    return () => { cancelled = true; };
  }, [pid]);

  // Proposed HAL identity for this pid -- a previously confirmed
  // personLinks entry if one exists, else a fresh ORCID match, else null
  // (see api/src/identityResolution.js's controllerSuggestIdentity for the
  // exact order). Purely a suggestion shown in CrossCheckDialog -- never
  // applied without the user clicking it.
  const [suggestedHalIdentity, setSuggestedHalIdentity] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSuggestedHalIdentity(null);
    fetchIdentitySuggestion(pid).then(info => { if (!cancelled) setSuggestedHalIdentity(info); });
    return () => { cancelled = true; };
  }, [pid]);

  // A personLinks-based suggestion (an already-confirmed link) never carries
  // a name -- controllerSuggestIdentity only ever attaches one to a fresh
  // ORCID match (see identityResolution.js's own resolveHalIdentityForPid).
  // This author's own DBLP name is already known and displayed at the top of
  // this very page, though, so it's used to fill that gap: CrossCheckDialog
  // then searches HAL by name up front instead of only pre-filling the
  // manual-id field, the same candidate(s) resurfacing as ordinary ranked
  // results. Memoized so this doesn't rebuild into a fresh object -- and
  // retrigger IdentityLinkDialog's pre-fill effect (keyed on the `suggestion`
  // reference) -- on every unrelated re-render while the dialog is open.
  const halSuggestion = useMemo(() => {
    if (!suggestedHalIdentity || suggestedHalIdentity.name) return suggestedHalIdentity;
    return { ...suggestedHalIdentity, name: trimLastDigits(author.name) };
  }, [suggestedHalIdentity, author.name]);

  const handleCrossCheckConfirm = (halId) => {
    setCrossCheckDialogOpen(false);
    // Fire-and-forget: every confirmed pairing (suggested or freshly
    // searched) feeds personLinks for next time, but a failed write here
    // must never block opening the cross-check report itself.
    postIdentityLink({ idHal: halId, pid }).catch(err => console.error('Failed to record identity link', err));
    // The currently active year range, not [minYear, maxYear] -- when the
    // filter isn't active, filterYears already equals [minYear, maxYear]
    // (see handleFilterActiveChange), so this covers that case too without
    // a separate branch. The cross-check page has no year control of its
    // own any more; it just inherits whatever range was showing here.
    onOpenAuthor({ type: 'crosscheck-author', id: `crosscheck:${pid}:${halId}`, pid, halId, label: pid, yearRange: filterYears });
  };

  return (
    <div className='App'>
      <RecordsHeader
        title={<>DBLP records of {trimLastDigits(author.name)}</>}
        details={<>
          pid: {pid}
          {authorInfo && (authorInfo.orcid
            ? <> · ORCID: <a href={authorInfo.orcid} target="_blank" rel="noreferrer">{authorInfo.orcid.replace('https://orcid.org/', '')}</a></>
            : (
              <span style={{ color: '#b26a00', marginLeft: '0.6em' }}>
                <WarningAmberIcon fontSize="inherit" style={{ verticalAlign: 'text-bottom', marginRight: '0.2em' }} />
                No ORCID linked to this DBLP record
              </span>
            ))}
        </>}
        showing={publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        exportButton={<ExportButton
          onExportMarkdown={() => exportDblpPublicationsMarkdown(filteredRecords, { title: `DBLP records of ${trimLastDigits(author.name)}`, filename: `dblp-${pid.replace(/\//g, '-')}.md`, sortMode })}
          onExportJson={() => exportDblpPublicationsJson(filteredRecords, { title: `DBLP records of ${trimLastDigits(author.name)}`, filename: `dblp-${pid.replace(/\//g, '-')}.json`, sortMode })}
          onExportCsv={() => exportDblpPublicationsCsv(filteredRecords, { filename: `dblp-${pid.replace(/\//g, '-')}.csv`, sortMode })}
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
          Cross-check with HAL
        </Button>
      </div>

      <CrossCheckDialog open={crossCheckDialogOpen} onClose={() => setCrossCheckDialogOpen(false)} onConfirm={handleCrossCheckConfirm} suggestion={halSuggestion} />

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>
      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      <Publications author={author} data={filteredRecords} onOpenAuthor={onOpenAuthor} selfPids={selfPids} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} isActive={isActive} sortMode={sortMode} />

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
