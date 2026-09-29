import { useEffect, useMemo, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';

// DBLP/HAL
import { fetchCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { fetchAuthorInfo } from '../dblp';
import { customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { exportCrossCheckMarkdown, exportCrossCheckJson } from '../exportCrossCheck';
import { getOverride, getSharedOverride, effectiveMatchType } from '../matchOverrides';
import { customProfileIdForPortal } from '../customRankings';
import { orderPublicationsForDisplay, DEFAULT_SORT_MODE } from '../rankOrder';

// Components
import DateRangeSlider from './DateRangeSlider';
import { FilterButton } from './FilterButton';
import { LoadingSpinner } from './LoadingSpinner';
import { RecordsHeader } from './RecordsHeader';
import { ReportButton } from './ReportButton';
import { CrossCheckSection, withRowNumbers, csvEscape } from './CrossCheckSection';
import { MatchConfidenceFilterButton } from './MatchConfidenceFilterButton';
import { SortButton } from './SortButton';

import '../App.css';
import { applyLocalDecisions, listIdentityLinks, removeCrosscheckDecision, LINKS_KEY } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { IdentityLinksIconButton } from './IdentityLinksIconButton';
import { CrosscheckDecisionFileButtons } from './CrosscheckDecisionsButton';
import { trimLastDigits } from '../utils';

const yearAccessor = result => parseInt(result.publication.dblp.year, 10) || 0;

// Same portal split as Author.js's own module-level portalAccessor --
// duplicated rather than imported since Author.js doesn't export it (it's
// only ever a couple of lines, and the two files' publication shapes only
// coincidentally match, see matchTypeAccessor below).
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

// Unlike CrossCheckStructure.js/CrossCheckTeam.js's own CrossCheckSection
// calls (nested inside their own per-member section, which already provides
// an outer width/margin), this page renders CrossCheckSection directly, so
// it needs its own top-level width/margin -- see CrossCheckSection.js's own
// boxSx/headingVariant comment. Module-level so it stays referentially
// stable across renders, same reasoning as NO_SELF_IDS there.
//
// width: '100%' is load-bearing, not decorative -- '.App' (App.css) is a
// flex column with align-items:center, so a direct flex-item child with
// only a maxWidth (no explicit width) shrinks-to-fit its own content
// instead of filling up to that maxWidth. A section's header row is
// left-aligned (justify-content defaults to flex-start), so as long as the
// section is OPEN (its wide row content forces the box wide) this went
// unnoticed -- but a section collapsed by default (Confirmed by you/
// automatically) has nothing but its own short header text to size against,
// so it shrinks to that text's width and then gets centered by '.App'
// instead of sitting flush left like every other (open) section -- exactly
// the "pas aligné" the maintainer saw live. width:'100%' pins the box to
// the full flex-item width every time, open or collapsed.
const SECTION_BOX_SX = { maxWidth: 900, width: '100%', margin: '0 auto 30px' };

// RecordsHeader's own default help content ("Cross-check compares the
// current source with its matching HAL/DBLP identity...") is circular on
// the cross-check page itself -- this page's own sections explain what it
// actually shows instead.
const CROSSCHECK_HELP_SECTIONS = [
  { title: 'Missing from HAL', description: 'A DBLP record with no matching HAL deposit at all for this HAL identity.' },
  { title: 'Not claimed on HAL', description: 'Already deposited in HAL (found by DOI/arXiv id), but not linked to this HAL identity -- usually because a co-author submitted it without selecting/validating this idHAL.' },
  { title: 'To review', description: 'An uncertain match was found in HAL -- confirm or reject whether it is really the same paper.' },
  { title: 'Confirmed', description: 'A strong/exact automatic match, or one already confirmed manually.' },
  { title: 'Export formats', description: 'Export always contains the records currently shown. Markdown is readable as a report, JSON preserves structured data, CSV opens in spreadsheet software, and the separate cross-check decisions file can be shared with collaborators.' },
];

// DBLP -> HAL crosscheck report for one (pid, halId) pair -- see
// api/src/crosscheck.js for the matching itself. Opened as its own tab from
// Author.js's "Cross-check with HAL" button (or a shared/reloaded
// /crosscheck/dblp/:pid/hal/:halId URL, see App.js's tabFromPath).
//
// initialYearRange/onYearRangeChange: same contract as Author.js's own (see
// its identical props) -- App.js threads this tab's ?from=&to= down and
// back up the same way it already does for dblp-author/hal-author/team/
// hal-structure. Used to be a one-shot yearRange prop inherited from
// whichever page's own filter was showing when "Cross-check with HAL" was
// clicked, with no control of its own here at all -- removed on purpose at
// the time (two independent "last N years" filters on two pages showing the
// same author, with no reason to ever disagree, read as confusing) but
// reinstated as a live control of its own, matching every other record page.
//
// Split into this thin fetch/loading wrapper and CrossCheckShow below,
// mirroring Author.js's own Author()/AuthorShow() split -- CrossCheckShow's
// own minYear/maxYear (derived from `results`) must never see a placeholder
// empty list, so it only ever mounts once `report` is already loaded.
export function CrossCheck({ pid, halId, initialYearRange, onYearRangeChange, onOpenAuthor, onSearchAuthor }) {
    const [automaticReport, setReport] = useState(null);
    const personalVersion = usePersonalDataVersion();
    const identityVersion = usePersonalDataVersion(LINKS_KEY);
    const effectiveHalId = listIdentityLinks({ pids: [pid] })[0]?.idHal || halId;
    // Personal storage changes invalidate the derived report without refetching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => automaticReport && applyLocalDecisions(automaticReport), [automaticReport, personalVersion]);
    const [error, setError] = useState(null);
    const { conferenceSource, journalSource } = useFilterSettings();

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchCrossCheck(pid, effectiveHalId, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [pid, effectiveHalId, conferenceSource, journalSource, identityVersion]);

    // dblpKey/halDocid identify the exact pair a maintainer just clicked
    // confirm/reject on. Choices are stored locally; errors are
    // surfaced the same way the initial load's own failure is (this page's
    // one `error` state), since a failed write left silent would look to
    // the maintainer like their click confirmed/rejected the pair when it
    // didn't.
    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .catch(err => setError(err));
    };

    // Undo just removes the stored decision -- applyLocalDecisions then
    // recomputes this pair's status from the automatic report alone on the
    // next render, same PERSONAL_DATA_EVENT-driven refresh confirming
    // already relies on, no separate fetch needed.
    const handleUndo = (dblpKey, halDocid) => removeCrosscheckDecision({ dblpKey, halDocid });

    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this author against HAL. Please try again later.</div>;
    if (report === null) return <LoadingSpinner message="Cross-checking DBLP against HAL…" />;

    return <CrossCheckShow
        report={report}
        pid={pid}
        effectiveHalId={effectiveHalId}
        initialYearRange={initialYearRange}
        onYearRangeChange={onYearRangeChange}
        onOpenAuthor={onOpenAuthor}
        onSearchAuthor={onSearchAuthor}
        onOverrideDecision={handleOverrideDecision}
        onUndo={handleUndo}
    />;
}

function CrossCheckShow({ report, pid, effectiveHalId, initialYearRange, onYearRangeChange, onOpenAuthor, onSearchAuthor, onOverrideDecision, onUndo }) {
    const { conferenceSource, journalSource, filterCategories, filterMatchTypes } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();
    // Local, not persisted via useFilterSettings -- see SortButton.js's own
    // comment: only sortMode/setSortMode itself lives per-page, same as
    // Author.js/AuthorHal.js/Team.js/Structure.js each keeping their own.
    const [sortMode, setSortMode] = useState(DEFAULT_SORT_MODE);
    const results = report.results;

    // Same minYear/maxYear derivation as Author.js's own (its identical
    // comment applies here too) -- safe against an empty list only as a
    // defensive fallback: this component never actually mounts with one,
    // see CrossCheck()'s own report===null gate above.
    const [minYear, maxYear] = useMemo(() => {
        if (results.length === 0) return [0, 0];
        return [Math.min(...results.map(yearAccessor)), Math.max(...results.map(yearAccessor))];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results.length]);
    // Same validInitialYearRange/filterYears/isFilterActive trio as
    // Author.js's own (identical comment) -- initialYearRange comes from the
    // tab's own ?from=&to= (App.js's tabFromPath), applied only at mount.
    const validInitialYearRange = Array.isArray(initialYearRange) && initialYearRange.length === 2
        && Number.isFinite(initialYearRange[0]) && Number.isFinite(initialYearRange[1]) && initialYearRange[0] <= initialYearRange[1]
        ? [Math.max(minYear, Math.min(initialYearRange[0], maxYear)), Math.max(minYear, Math.min(initialYearRange[1], maxYear))]
        : null;
    const [filterYears, setFilterYears] = useState(() => validInitialYearRange || [minYear, maxYear]);
    const [isFilterActive, setIsFilterActive] = useState(() => validInitialYearRange !== null);

    // Hiding the filter also clears it -- same as Author.js's identical
    // handleFilterActiveChange.
    const handleFilterActiveChange = (active) => {
        setIsFilterActive(active);
        if (!active) setFilterYears([minYear, maxYear]);
    };

    // Mirrors the change back up to App.js -- see this file's own
    // initialYearRange/onYearRangeChange comment above, and Author.js's
    // identical effect.
    useEffect(() => {
        onYearRangeChange?.(isFilterActive ? filterYears : undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterYears, isFilterActive]);

    // Stable across renders unless pid itself changes -- see Publications.js's
    // PublicationRow, whose React.memo this would otherwise defeat for every
    // row on every render (same reasoning as Publications()'s own `pids`).
    const pids = useMemo(() => [pid], [pid]);
    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );
    // Same idea as Author.js's own matchTypeAccessor -- delegates to
    // effectiveMatchType so the match-confidence checkboxes always mean
    // exactly what RankBadge.js's own dot shows for a missing/to-review
    // publication's rank (the only ones that ever carry one here, see
    // api/src/crosscheck.js's needsRank).
    const matchTypeAccessor = pub => {
        if (!pub.rank) return undefined;
        const portal = portalAccessor(pub);
        const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
        const override = getOverride(portal, pub.rank);
        const sharedOverride = !override ? getSharedOverride(pub.rank, sharedMaps[portal]) : null;
        return effectiveMatchType(pub.rank, { customProfileId, override, sharedOverride });
    };

    // This person's own dblp display name, for the header below -- a tab
    // opened directly by pid (or reloaded from a bare URL) has no name of
    // its own to show otherwise. api/src/dblp.js's controllerAuthorInfo
    // resolves it off the same www/homepages record getAuthorNames already
    // reads; null (not a crash) while loading or for an unresolvable name,
    // falling back to the bare pid in the title below.
    const [authorName, setAuthorName] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setAuthorName(null);
        fetchAuthorInfo(pid).then(info => { if (!cancelled) setAuthorName(info.name); }).catch(() => {});
        return () => { cancelled = true; };
    }, [pid]);
    const displayName = authorName ? trimLastDigits(authorName) : pid;

    // Category/match-confidence filters are the same CategoriesFilterButton.js/
    // MatchConfidenceFilterButton.js machinery Author.js/AuthorHal.js already
    // apply to their own publication lists -- publication.type here is
    // already dblp's own vocabulary (dblpCategories' keys), so no accessor
    // translation is needed the way HAL's raw type codes would. A row
    // lacking a rank at all (every 'confirmed' automatic/decided row -- see
    // api/src/crosscheck.js's needsRank) always passes the match-confidence
    // filter, same null-safe rule as filterPublications.js's own. filterYears
    // is unconditionally applied (same as Author.js's own filterPublications
    // call) -- when the filter is inactive it already equals [minYear,
    // maxYear], a no-op range, rather than a separate hasYearRange branch.
    const filtered = results
        .filter(r => yearAccessor(r) >= filterYears[0] && yearAccessor(r) <= filterYears[1])
        .filter(r => filterCategories[r.publication.type])
        .filter(r => !r.publication.rank || filterMatchTypes[matchTypeAccessor(r.publication)]);
    // Numbered once across the whole (year-)filtered list -- not per
    // section -- so e.g. "[j1]" means the same thing it would on the
    // regular author page (oldest journal article in the current view),
    // rather than "the only journal article that happens to be missing/to
    // review", which looked like a wrong/confusing number to the maintainer
    // (a single to-review item always showed as "[j1]" regardless of its
    // real position among this author's journal articles). Numbered BEFORE
    // sorting for display -- withRowNumbers relies on its input already
    // being in dblp's own most-recent-first order (see its own comment),
    // which `filtered` still is (plain .filter() never reorders); sortMode
    // then only changes DISPLAY order, never which number a given
    // publication gets.
    const numbered = withRowNumbers(filtered);
    // 'date' (the default) keeps the canonical order as-is; otherwise reuse
    // rankOrder.js's own orderPublicationsForDisplay -- the exact same
    // function Publications.js/HalPublications.js use -- just discarding its
    // 'group' markers, since CrossCheckSection.js's named sections (Missing/
    // Not claimed/To review/Confirmed) already provide the only grouping
    // this page shows; year/rank-tier subheadings inside one of those would
    // be redundant clutter for what's usually a handful of rows.
    const sortedNumbered = sortMode === DEFAULT_SORT_MODE ? numbered : orderPublicationsForDisplay(
        numbered, sortMode,
        { yearOf: n => yearAccessor(n.result), rankOf: n => n.result.publication.rank }
    ).filter(row => row.kind === 'item').map(row => row.record);
    // "Missing from HAL" vs "Not claimed on HAL": api/src/crosscheck.js only
    // ever sets unclaimedMatch on a 'missing' result, so this is a pure
    // split of the same status, not a new one -- see its own comment for why
    // the status itself stays 'missing' (CSV/MD/JSON exports, etc. still see
    // one consistent status vocabulary).
    const missingRows = sortedNumbered.filter(({ result }) => result.status === 'missing' && !result.unclaimedMatch);
    const unclaimedRows = sortedNumbered.filter(({ result }) => result.status === 'missing' && result.unclaimedMatch);
    const toReviewRows = sortedNumbered.filter(({ result }) => result.status === 'to-review');
    // A decided-confirmed row (a manual click, or an imported decision file)
    // is surfaced with an undo below; a 'confirmed' row statusFromMatches
    // (api/src/crosscheck.js) produced on its own -- an exact DOI/arXiv or
    // strong title+year match, no local decision behind it -- is not: there
    // can be hundreds of those, and there is nothing to undo.
    const confirmedRows = sortedNumbered.filter(({ result }) => result.status === 'confirmed' && result.decided);
    // Shown in its own "Confirmed automatically" section below
    // (CrossCheckSection's confirmed mode with no onUndo -- nothing to undo
    // for a pure automatic match), collapsed by default -- there can be
    // hundreds of these for a prolific author.
    const automaticConfirmedRows = sortedNumbered.filter(({ result }) => result.status === 'confirmed' && !result.decided);
    // Same 3-branch wording as Author.js's own RecordsHeader `showing` text.
    const showingText = filtered.length === 0
        ? 'No record found'
        : filtered.length === results.length
            ? `Showing all ${filtered.length} records`
            : `Showing ${filtered.length} of ${results.length} records over ${filterYears[1] - filterYears[0] + 1} years`;

    const importedAtLabel = report.dblpStatus.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    const handleExportCsv = () => exportCsv(pid, filtered);
    const handleExportMarkdown = () => exportCrossCheckMarkdown({
        title: `DBLP → HAL cross-check for ${displayName}`,
        filename: `crosscheck-${pid.replace(/\//g, '-')}.md`,
        results: filtered,
    });
    const handleExportJson = () => exportCrossCheckJson({
        title: `DBLP → HAL cross-check for ${displayName}`,
        filename: `crosscheck-${pid.replace(/\//g, '-')}.json`,
        results: filtered,
    });

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <RecordsHeader
                title={<>DBLP → HAL cross-check for {displayName}</>}
                details={<>pid: {pid} · idHal: {effectiveHalId}</>}
                showing={showingText}
                helpTitle="Cross-check help"
                helpSections={CROSSCHECK_HELP_SECTIONS}
                exportButton={<Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <IdentityLinksIconButton pids={[pid]} />
                    <CrosscheckDecisionFileButtons report={report} scope={{ type: 'author', pid, idHal: effectiveHalId }} />
                    <ReportButton title="Cross-check report" onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} />
                </Box>}
            />

            <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '20px auto 20px' }}>
                {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                {report.halCacheNote}
            </Alert>

            <div style={{ margin: '0 0 20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
                <MatchConfidenceFilterButton records={results} filterKey={r => matchTypeAccessor(r.publication)} />
                <SortButton sortMode={sortMode} setSortMode={setSortMode} />
            </div>
            {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

            <div style={{ height: '20px' }} />

            <CrossCheckSection title="Missing from HAL" rows={missingRows} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} boxSx={SECTION_BOX_SX} headingVariant="h6" />
            {unclaimedRows.length > 0 && (
                <CrossCheckSection
                    title="Not claimed on HAL"
                    description="These are already deposited in HAL, but not linked to your HAL identity -- likely deposited by a co-author who didn't select/validate your idHAL when submitting."
                    rows={unclaimedRows}
                    unclaimed
                    pids={pids}
                    onOpenAuthor={onOpenAuthor}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
                    boxSx={SECTION_BOX_SX}
                    headingVariant="h6"
                />
            )}
            <CrossCheckSection
                title="To review"
                description="These DBLP publications only found an uncertain match in HAL — check whether it's really the same paper before treating it as deposited."
                rows={toReviewRows}
                showCandidates
                pids={pids}
                onOpenAuthor={onOpenAuthor}
                onSearchAuthor={onSearchAuthor}
                onDecide={onOverrideDecision}
                sharedMaps={sharedMaps}
                activeCustomProfileIds={activeCustomProfileIds}
                boxSx={SECTION_BOX_SX}
                headingVariant="h6"
            />

            <CrossCheckSection
                title="Confirmed by you"
                rows={confirmedRows}
                confirmed
                defaultOpen={false}
                pids={pids}
                onOpenAuthor={onOpenAuthor}
                onSearchAuthor={onSearchAuthor}
                onUndo={onUndo}
                sharedMaps={sharedMaps}
                activeCustomProfileIds={activeCustomProfileIds}
                boxSx={SECTION_BOX_SX}
                headingVariant="h6"
            />
            <CrossCheckSection
                title="Confirmed automatically"
                rows={automaticConfirmedRows}
                confirmed
                defaultOpen={false}
                pids={pids}
                onOpenAuthor={onOpenAuthor}
                onSearchAuthor={onSearchAuthor}
                sharedMaps={sharedMaps}
                activeCustomProfileIds={activeCustomProfileIds}
                boxSx={SECTION_BOX_SX}
                headingVariant="h6"
            />
        </div>
    );
}

// Client-side only, no backend round trip -- generated straight from the
// currently year-filtered results already held in state.
function exportCsv(pid, results) {
    const rows = [['status', 'title', 'year', 'venue', 'type', 'dblpKey', 'halCandidates']];
    for (const { status, publication, matches } of results) {
        rows.push([
            status,
            publication.dblp.title,
            publication.dblp.year,
            publication.venue,
            publication.type,
            publication.dblp.key,
            matches.map(m => `${m.halPub.title}${m.distance != null ? ` (d=${m.distance})` : ''}`).join(' | '),
        ]);
    }
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crosscheck-${pid.replace(/\//g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
