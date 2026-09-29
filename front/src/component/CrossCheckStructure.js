import { useEffect, useMemo, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// DBLP/HAL
import { fetchStructureCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { exportCrossCheckByMemberMarkdown, exportCrossCheckByMemberJson } from '../exportCrossCheck';
import { getOverride, getSharedOverride, effectiveMatchType } from '../matchOverrides';
import { customProfileIdForPortal } from '../customRankings';
import { orderPublicationsForDisplay, DEFAULT_SORT_MODE } from '../rankOrder';

// Components
import DateRangeSlider from './DateRangeSlider';
import { FilterButton } from './FilterButton';
import { LoadingSpinner } from './LoadingSpinner';
import { ReportButton } from './ReportButton';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { CrossCheckIdentityHeader } from './CrossCheckIdentityHeader';
import { CrossCheckSection, withRowNumbers, csvEscape } from './CrossCheckSection';
import { MatchConfidenceFilterButton } from './MatchConfidenceFilterButton';
import { SortButton } from './SortButton';

import '../App.css';
import { applyLocalDecisions, removeCrosscheckDecision, LINKS_KEY } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { CrosscheckDecisionFileButtons } from './CrosscheckDecisionsButton';

// Structure-scope sibling of CrossCheck.js/CrossCheckTeam.js (see
// api/src/crosscheckStructure.js). Unlike a rankme "team" (client-side only,
// see CrossCheckTeam.js's own comment), a HAL structure has a stable
// server-side structId and its whole membership is already resolved by
// identityResolution.js's own name/orcid pipeline (getStructureCrossCheckReport
// attaches a real `name` to every member, resolved or not) -- so this takes
// structId directly as a prop instead of reading a client-side store, and
// its network call is a plain GET keyed by structId, no member list to send.
const yearAccessor = r => parseInt(r.publication.dblp.year, 10) || 0;

// See CrossCheck.js's identical portalAccessor comment.
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

// initialYearRange/onYearRangeChange: see CrossCheck.js's identical comment
// -- threaded straight through to CrossCheckStructureContent below.
//
// Split into this thin fetch/loading wrapper and CrossCheckStructureContent
// below, mirroring CrossCheck.js's own CrossCheck()/CrossCheckShow() split
// -- CrossCheckStructureContent's own minYear/maxYear (derived from every
// member's results) must never see a placeholder empty report, so it only
// ever mounts once `report` is already loaded.
export function CrossCheckStructure({ structId, structureName, onOpenAuthor, onSearchAuthor, initialYearRange, onYearRangeChange }) {
    const [automaticReport, setReport] = useState(null);
    const personalVersion = usePersonalDataVersion();
    const identityVersion = usePersonalDataVersion(LINKS_KEY);
    // Personal storage changes invalidate the derived report without refetching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => automaticReport && applyLocalDecisions(automaticReport), [automaticReport, personalVersion]);
    const [error, setError] = useState(null);
    // Identity edits can require a new automatic report; decisions are local.
    // A cross-check starts with the same identity-resolution dialog available
    // from the structure page. It can be revisited from the header icon.
    const [identityPanelOpen, setIdentityPanelOpen] = useState(true);
    const { conferenceSource, journalSource } = useFilterSettings();

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchStructureCrossCheck(structId, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [structId, conferenceSource, journalSource, identityVersion]);

    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .catch(err => setError(err));
    };

    // See CrossCheck.js's identical handleUndo comment.
    const handleUndo = (dblpKey, halDocid) => removeCrosscheckDecision({ dblpKey, halDocid });

    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this structure against HAL. Please try again later.</div>;
    // The member count isn't known up front the way CrossCheckTeam.js's own
    // team.members.length is -- a structure's membership only exists once
    // getStructureCrossCheckReport has resolved it server-side, there is no
    // client-side list to read a count from before that first response lands.
    if (report === null) return <>
        <IdentityLinksPanel open={identityPanelOpen} onClose={() => setIdentityPanelOpen(false)} onViewResults={() => setIdentityPanelOpen(false)} structId={structId} />
        <LoadingSpinner message="Cross-checking structure members against HAL…" />
    </>;

    return <CrossCheckStructureContent
        structId={structId}
        structureName={structureName}
        report={report}
        identityPanelOpen={identityPanelOpen}
        setIdentityPanelOpen={setIdentityPanelOpen}
        initialYearRange={initialYearRange}
        onYearRangeChange={onYearRangeChange}
        onOpenAuthor={onOpenAuthor}
        onSearchAuthor={onSearchAuthor}
        onOverrideDecision={handleOverrideDecision}
        onUndo={handleUndo}
    />;
}

function CrossCheckStructureContent({ structId, structureName, report, identityPanelOpen, setIdentityPanelOpen, initialYearRange, onYearRangeChange, onOpenAuthor, onSearchAuthor, onOverrideDecision, onUndo }) {
    const { conferenceSource, journalSource, filterCategories, filterMatchTypes } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();
    // See CrossCheck.js's identical sortMode comment.
    const [sortMode, setSortMode] = useState(DEFAULT_SORT_MODE);

    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );
    // See CrossCheck.js's identical matchTypeAccessor comment.
    const matchTypeAccessor = pub => {
        if (!pub.rank) return undefined;
        const portal = portalAccessor(pub);
        const customProfileId = customProfileIdForPortal(activeCustomProfileIds, portal);
        const override = getOverride(portal, pub.rank);
        const sharedOverride = !override ? getSharedOverride(pub.rank, sharedMaps[portal]) : null;
        return effectiveMatchType(pub.rank, { customProfileId, override, sharedOverride });
    };

    const allResults = useMemo(() => report.members.flatMap(m => m.results), [report]);
    // See CrossCheck.js's identical minYear/maxYear comment.
    const [minYear, maxYear] = useMemo(() => {
        if (allResults.length === 0) return [0, 0];
        return [Math.min(...allResults.map(yearAccessor)), Math.max(...allResults.map(yearAccessor))];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allResults.length]);
    // See CrossCheck.js's identical validInitialYearRange/filterYears/
    // isFilterActive trio.
    const validInitialYearRange = Array.isArray(initialYearRange) && initialYearRange.length === 2
        && Number.isFinite(initialYearRange[0]) && Number.isFinite(initialYearRange[1]) && initialYearRange[0] <= initialYearRange[1]
        ? [Math.max(minYear, Math.min(initialYearRange[0], maxYear)), Math.max(minYear, Math.min(initialYearRange[1], maxYear))]
        : null;
    const [filterYears, setFilterYears] = useState(() => validInitialYearRange || [minYear, maxYear]);
    const [isFilterActive, setIsFilterActive] = useState(() => validInitialYearRange !== null);

    const handleFilterActiveChange = (active) => {
        setIsFilterActive(active);
        if (!active) setFilterYears([minYear, maxYear]);
    };

    useEffect(() => {
        onYearRangeChange?.(isFilterActive ? filterYears : undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterYears, isFilterActive]);

    const importedAtLabel = report.dblpStatus?.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    // Category/match-confidence/year filters: see CrossCheck.js's identical
    // comment. An automatically-confirmed result is now surfaced (collapsed
    // by default, no undo) in its own member's "Confirmed automatically"
    // section, same as a decided one's "Confirmed" section -- see
    // StructureMemberSection below.
    const filteredMembers = report.members.map(member => {
        const results = member.results
            .filter(r => yearAccessor(r) >= filterYears[0] && yearAccessor(r) <= filterYears[1])
            .filter(r => filterCategories[r.publication.type])
            .filter(r => !r.publication.rank || filterMatchTypes[matchTypeAccessor(r.publication)]);
        return { ...member, results };
    });
    const totalFiltered = filteredMembers.reduce((sum, m) => sum + m.results.length, 0);
    // See CrossCheck.js's identical showingText comment.
    const showingText = totalFiltered === 0
        ? 'No record found'
        : totalFiltered === allResults.length
            ? `Showing all ${totalFiltered} records`
            : `Showing ${totalFiltered} of ${allResults.length} records over ${filterYears[1] - filterYears[0] + 1} years`;

    const handleExportCsv = () => exportCsv(structId, filteredMembers);
    const title = structureName || structId;
    const memberLabel = member => `${member.name || member.idHal} (idHal: ${member.idHal}, pid: ${member.pid})`;
    const handleExportMarkdown = () => exportCrossCheckByMemberMarkdown({
        title: `DBLP → HAL cross-check for ${title}`,
        filename: `crosscheck-structure-${structId}.md`,
        members: filteredMembers,
        memberLabel,
    });
    const handleExportJson = () => exportCrossCheckByMemberJson({
        title: `DBLP → HAL cross-check for ${title}`,
        filename: `crosscheck-structure-${structId}.json`,
        members: filteredMembers,
        memberLabel,
    });
    const allMembers = [
        ...report.members.map(member => ({ id: member.idHal, idKind: 'idHal', label: member.name })),
        ...report.unresolvedMembers.map(member => ({ id: member.idHal, idKind: 'idHal', label: member.name })),
    ];

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <CrossCheckIdentityHeader title={`DBLP → HAL cross-check for ${title}`} scope="Structure" members={allMembers} unresolvedCount={report.unresolvedMembers.length} targetLabel="DBLP" panelOpen={identityPanelOpen} setPanelOpen={setIdentityPanelOpen} panelProps={{ structId }} />

            {(importedAtLabel || report.halCacheNote) && (
                <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
                    {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                    {report.halCacheNote}
                </Alert>
            )}

            <Box sx={{ textAlign: 'center', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">{showingText}</Typography>
                <CrosscheckDecisionFileButtons report={report} scope={{ type: 'structure', id: structId }} />
                <ReportButton title="Cross-check report" onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={report.members.length === 0} />
            </Box>

            <Box sx={{ textAlign: 'center', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
                <MatchConfidenceFilterButton records={allResults} filterKey={r => matchTypeAccessor(r.publication)} />
                <SortButton sortMode={sortMode} setSortMode={setSortMode} />
            </Box>
            {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

            <div style={{ height: '20px' }} />

            {report.members.length === 0 && report.unresolvedMembers.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>No members in this structure</Typography>
            )}

            {filteredMembers.map(member => (
                <StructureMemberSection
                    key={member.idHal}
                    member={member}
                    sortMode={sortMode}
                    onOpenAuthor={onOpenAuthor}
                    onSearchAuthor={onSearchAuthor}
                    onDecide={onOverrideDecision}
                    onUndo={onUndo}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
                />
            ))}
        </div>
    );
}

// One resolved member's own Missing/To-review sections, scoped to just this
// member's own results -- see CrossCheckSection.js's withRowNumbers for the
// numbering rule.
function StructureMemberSection({ member, sortMode, onOpenAuthor, onSearchAuthor, onDecide, onUndo, sharedMaps, activeCustomProfileIds }) {
    const pids = useMemo(() => [member.pid], [member.pid]);
    // See CrossCheck.js's identical numbered/sortedNumbered comment.
    const numbered = withRowNumbers(member.results);
    const sortedNumbered = sortMode === DEFAULT_SORT_MODE ? numbered : orderPublicationsForDisplay(
        numbered, sortMode,
        { yearOf: n => yearAccessor(n.result), rankOf: n => n.result.publication.rank }
    ).filter(row => row.kind === 'item').map(row => row.record);
    const missingRows = sortedNumbered.filter(({ result }) => result.status === 'missing' && !result.unclaimedMatch);
    const unclaimedRows = sortedNumbered.filter(({ result }) => result.status === 'missing' && result.unclaimedMatch);
    const toReviewRows = sortedNumbered.filter(({ result }) => result.status === 'to-review');
    // See CrossCheck.js's identical confirmedRows comment.
    const confirmedRows = sortedNumbered.filter(({ result }) => result.status === 'confirmed' && result.decided);
    // See CrossCheck.js's identical automaticConfirmedRows comment.
    const automaticConfirmedRows = sortedNumbered.filter(({ result }) => result.status === 'confirmed' && !result.decided);

    return (
        <Box sx={{ maxWidth: 900, margin: '0 auto 40px' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Publications for {member.name || member.idHal} (idHal: {member.idHal}, pid: {member.pid})
            </Typography>
            <CrossCheckSection title="Missing from HAL" rows={missingRows} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
            {unclaimedRows.length > 0 && (
                <CrossCheckSection
                    title="Not claimed on HAL"
                    description="These are already deposited in HAL, but not linked to this person's HAL identity -- likely deposited by a co-author who didn't select/validate their idHAL when submitting."
                    rows={unclaimedRows}
                    unclaimed
                    pids={pids}
                    onOpenAuthor={onOpenAuthor}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
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
                onDecide={onDecide}
                sharedMaps={sharedMaps}
                activeCustomProfileIds={activeCustomProfileIds}
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
            />
        </Box>
    );
}

// Client-side only, no backend round trip -- same as CrossCheckTeam.js's own
// exportCsv, plus a `member` column since this report spans several people.
function exportCsv(structId, members) {
    const rows = [['member', 'status', 'title', 'year', 'venue', 'type', 'dblpKey', 'halCandidates']];
    for (const member of members) {
        const memberLabel = `${member.name || member.idHal} (idHal: ${member.idHal}, pid: ${member.pid})`;
        for (const { status, publication, matches } of member.results) {
            rows.push([
                memberLabel,
                status,
                publication.dblp.title,
                publication.dblp.year,
                publication.venue,
                publication.type,
                publication.dblp.key,
                matches.map(m => `${m.halPub.title}${m.distance != null ? ` (d=${m.distance})` : ''}`).join(' | '),
            ]);
        }
    }
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crosscheck-structure-${structId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
