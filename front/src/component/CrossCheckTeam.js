import { useEffect, useMemo, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// DBLP/HAL
import { fetchTeamCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { getTeam } from '../teamStore';
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

// Team-scope sibling of CrossCheck.js (single-author DBLP -> HAL crosscheck)
// -- see api/src/crosscheckTeam.js. The row/section rendering below is
// adapted to run once per resolved team member instead of once for the
// whole page, plus a member column in the CSV export.
const yearAccessor = r => parseInt(r.publication.dblp.year, 10) || 0;

// See CrossCheck.js's identical portalAccessor comment.
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

// A rankme "team" has no server-side existence at all (front/src/teamStore.js,
// localStorage only) -- teamId only ever resolves client-side, so this reads
// it the same way Team.js does before doing anything else, including for a
// tab reopened from a bare /crosscheck/team/:teamId URL.
//
// initialYearRange/onYearRangeChange: see CrossCheck.js's identical comment
// -- threaded straight through to CrossCheckTeamContent below.
export function CrossCheckTeam({ teamId, onOpenAuthor, onSearchAuthor, isActive, initialYearRange, onYearRangeChange }) {
    // getTeam reads and parses localStorage. Keep this snapshot stable for the
    // lifetime of this route: otherwise every state update creates a new
    // members array, retriggers the fetching effect below and clears the
    // report before it can ever be displayed.
    const team = useMemo(() => getTeam(teamId), [teamId]);

    if (!team) {
        return <div style={{ textAlign: 'center', marginTop: '80px' }}>This team no longer exists.</div>;
    }

    return <CrossCheckTeamShow team={team} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} isActive={isActive} initialYearRange={initialYearRange} onYearRangeChange={onYearRangeChange} />;
}

// Thin fetch/loading wrapper, mirroring CrossCheck.js's own CrossCheck()/
// CrossCheckShow() split -- CrossCheckTeamContent's own minYear/maxYear
// (derived from every member's results) must never see a placeholder empty
// report, so it only ever mounts once `report` is already loaded.
function CrossCheckTeamShow({ team, onOpenAuthor, onSearchAuthor, initialYearRange, onYearRangeChange }) {
    const [automaticReport, setReport] = useState(null);
    const personalVersion = usePersonalDataVersion();
    const identityVersion = usePersonalDataVersion(LINKS_KEY);
    // Personal storage changes invalidate the derived report without refetching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => automaticReport && applyLocalDecisions(automaticReport), [automaticReport, personalVersion]);
    const [error, setError] = useState(null);
    // Identity edits can require a new automatic report; decisions are local.
    const [identityPanelOpen, setIdentityPanelOpen] = useState(true);
    const { conferenceSource, journalSource } = useFilterSettings();

    const pids = useMemo(() => team.members.map(m => m.id), [team]);
    const identityMembers = useMemo(() => team.members.map(member => ({ id: member.id, name: member.label })), [team.members]);

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchTeamCrossCheck({ source: team.source, pids }, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [team.id, team.source, pids, conferenceSource, journalSource, identityVersion]);

    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .catch(err => setError(err));
    };

    // See CrossCheck.js's identical handleUndo comment.
    const handleUndo = (dblpKey, halDocid) => removeCrosscheckDecision({ dblpKey, halDocid });

    const targetLabel = team.source === 'dblp' ? 'HAL' : 'DBLP';
    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this team against {targetLabel}. Please try again later.</div>;
    if (report === null) return <>
        <IdentityLinksPanel open={identityPanelOpen} onClose={() => setIdentityPanelOpen(false)} onViewResults={() => setIdentityPanelOpen(false)} teamSource={team.source} teamMembers={identityMembers} />
        <LoadingSpinner message={`Cross-checking ${team.members.length} members against ${targetLabel}…`} />
    </>;

    return <CrossCheckTeamContent
        team={team}
        report={report}
        targetLabel={targetLabel}
        identityMembers={identityMembers}
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

function CrossCheckTeamContent({ team, report, targetLabel, identityMembers, identityPanelOpen, setIdentityPanelOpen, initialYearRange, onYearRangeChange, onOpenAuthor, onSearchAuthor, onOverrideDecision, onUndo }) {
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
    // comment -- same global CategoriesFilterButton.js/
    // MatchConfidenceFilterButton.js machinery, publication.type is already
    // dblp's own vocabulary. An automatically-confirmed result is now
    // surfaced (collapsed by default, no undo) in its own member's
    // "Confirmed automatically" section, same as a decided one's "Confirmed"
    // section -- see TeamMemberSection below.
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

    const handleExportCsv = () => exportCsv(team, filteredMembers);
    const memberLabel = member => `${member.name || member.pid} (pid: ${member.pid}, idHal: ${member.idHal})`;
    const handleExportMarkdown = () => exportCrossCheckByMemberMarkdown({
        title: `DBLP → HAL cross-check for ${team.name}`,
        filename: `crosscheck-team-${team.id}.md`,
        members: filteredMembers,
        memberLabel,
    });
    const handleExportJson = () => exportCrossCheckByMemberJson({
        title: `DBLP → HAL cross-check for ${team.name}`,
        filename: `crosscheck-team-${team.id}.json`,
        members: filteredMembers,
        memberLabel,
    });

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <CrossCheckIdentityHeader title={`DBLP → HAL cross-check for ${team.name}`} scope="Team" members={team.members.map(member => ({ id: member.id, label: member.label, idKind: team.source === 'hal' ? 'idHal' : 'pid' }))} unresolvedCount={report.unresolvedMembers.length} targetLabel={targetLabel} panelOpen={identityPanelOpen} setPanelOpen={setIdentityPanelOpen} panelProps={{ teamSource: team.source, teamMembers: identityMembers }} />

            {(importedAtLabel || report.halCacheNote) && (
                <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
                    {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                    {report.halCacheNote}
                </Alert>
            )}

            <Box sx={{ textAlign: 'center', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">{showingText}</Typography>
                <CrosscheckDecisionFileButtons report={report} scope={{ type: 'team', id: team.id, name: team.name }} />
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
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>No members in this team</Typography>
            )}

            {filteredMembers.map(member => (
                <TeamMemberSection
                    key={member.pid}
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

// One resolved member's own Missing/To-review sections, under a subtitle
// naming them -- see CrossCheckSection.js's own withRowNumbers for the
// numbering rule this mirrors, here scoped to just this member's own
// results so a number still means "Nth item of this type among this
// member's own publications", not something meaningless spanning several
// different people's dblp records.
function TeamMemberSection({ member, sortMode, onOpenAuthor, onSearchAuthor, onDecide, onUndo, sharedMaps, activeCustomProfileIds }) {
    const pids = useMemo(() => [member.pid], [member.pid]);
    // See CrossCheck.js's identical numbered/sortedNumbered comment --
    // numbering always happens on the canonical date-desc order first, sort
    // only changes display order afterward.
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
                Publications for {member.name || member.pid} (pid: {member.pid}, idHal: {member.idHal})
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

// Client-side only, no backend round trip -- same as CrossCheck.js's own
// exportCsv, plus a `member` column since this report spans several people.
function exportCsv(team, members) {
    const rows = [['member', 'status', 'title', 'year', 'venue', 'type', 'dblpKey', 'halCandidates']];
    for (const member of members) {
        const memberLabel = `${member.name || member.pid} (pid: ${member.pid}, idHal: ${member.idHal})`;
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
    a.download = `crosscheck-team-${team.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
