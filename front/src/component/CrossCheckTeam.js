import { useEffect, useMemo, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

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

// A rankme "team" has no server-side existence at all (front/src/teamStore.js,
// localStorage only) -- teamId only ever resolves client-side, so this reads
// it the same way Team.js does before doing anything else, including for a
// tab reopened from a bare /crosscheck/team/:teamId URL.
// yearRange: see CrossCheck.js's identical comment -- the team page's own
// year filter (Team.js), active at the moment "Cross-check with
// HAL"/"Cross-check with DBLP" was clicked.
const yearAccessor = r => parseInt(r.publication.dblp.year, 10) || 0;

// See CrossCheck.js's identical portalAccessor comment.
const portalAccessor = pub => pub.type === 'inproceedings' ? 'core' : 'sjr';

export function CrossCheckTeam({ teamId, onOpenAuthor, onSearchAuthor, isActive, yearRange }) {
    // getTeam reads and parses localStorage. Keep this snapshot stable for the
    // lifetime of this route: otherwise every state update creates a new
    // members array, retriggers the fetching effect below and clears the
    // report before it can ever be displayed.
    const team = useMemo(() => getTeam(teamId), [teamId]);

    if (!team) {
        return <div style={{ textAlign: 'center', marginTop: '80px' }}>This team no longer exists.</div>;
    }

    return <CrossCheckTeamShow team={team} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} isActive={isActive} yearRange={yearRange} />;
}

function CrossCheckTeamShow({ team, onOpenAuthor, onSearchAuthor, yearRange }) {
    const [automaticReport, setReport] = useState(null);
    const personalVersion = usePersonalDataVersion();
    const identityVersion = usePersonalDataVersion(LINKS_KEY);
    // Personal storage changes invalidate the derived report without refetching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => automaticReport && applyLocalDecisions(automaticReport), [automaticReport, personalVersion]);
    const [error, setError] = useState(null);
    // Identity edits can require a new automatic report; decisions are local.
    const [identityPanelOpen, setIdentityPanelOpen] = useState(true);
    const { conferenceSource, journalSource, filterCategories, filterMatchTypes } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();
    // See CrossCheck.js's identical sortMode comment.
    const [sortMode, setSortMode] = useState(DEFAULT_SORT_MODE);

    const pids = useMemo(() => team.members.map(m => m.id), [team]);
    const identityMembers = useMemo(() => team.members.map(member => ({ id: member.id, name: member.label })), [team.members]);
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

    const importedAtLabel = report.dblpStatus?.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    // See CrossCheckStructure.js's identical hasYearRange/filteredMembers
    // comment -- same reasoning, confirmedCount recomputed from the same
    // filtered set so "N confirmed, not shown" matches the current range.
    // Only the automatic ones count here -- a decided-confirmed result is
    // now surfaced (with undo) in its own member's "Confirmed" section
    // instead, see TeamMemberSection below.
    const hasYearRange = Array.isArray(yearRange) && yearRange.length === 2 && Number.isFinite(yearRange[0]) && Number.isFinite(yearRange[1]);
    // Category/match-confidence filters: see CrossCheck.js's identical
    // comment -- same global CategoriesFilterButton.js/
    // MatchConfidenceFilterButton.js machinery, publication.type is already
    // dblp's own vocabulary.
    const filteredMembers = report.members.map(member => {
        const results = member.results
            .filter(r => !hasYearRange || (yearAccessor(r) >= yearRange[0] && yearAccessor(r) <= yearRange[1]))
            .filter(r => filterCategories[r.publication.type])
            .filter(r => !r.publication.rank || filterMatchTypes[matchTypeAccessor(r.publication)]);
        return { ...member, results, confirmedCount: results.filter(r => r.status === 'confirmed' && !r.decided).length };
    });
    const totalConfirmedCount = filteredMembers.reduce((sum, m) => sum + m.confirmedCount, 0);
    const totalRaw = report.members.reduce((sum, m) => sum + m.results.length, 0);
    const totalFiltered = filteredMembers.reduce((sum, m) => sum + m.results.length, 0);
    // See CrossCheck.js's identical showingText comment.
    const showingText = totalFiltered === 0
        ? 'No record found'
        : totalFiltered === totalRaw
            ? `Showing all ${totalFiltered} records`
            : `Showing ${totalFiltered} of ${totalRaw} records${hasYearRange ? ` over ${yearRange[1] - yearRange[0] + 1} years` : ''}`;

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

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>{showingText}</Typography>

            <Box sx={{ textAlign: 'center', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                <MatchConfidenceFilterButton records={report.members.flatMap(m => m.results)} filterKey={r => matchTypeAccessor(r.publication)} />
                <SortButton sortMode={sortMode} setSortMode={setSortMode} />
            </Box>

            <Box sx={{ textAlign: 'center', marginBottom: '30px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <CrosscheckDecisionFileButtons report={report} scope={{ type: 'team', id: team.id, name: team.name }} />
                <ReportButton title="Cross-check report" onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={report.members.length === 0} />
            </Box>

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
                    onDecide={handleOverrideDecision}
                    onUndo={handleUndo}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
                />
            ))}

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {totalConfirmedCount} confirmed automatically, not shown
            </Typography>
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
    // Collapsed by default, one flag per member -- see CrossCheck.js's
    // identical confirmedOpen comment.
    const [confirmedOpen, setConfirmedOpen] = useState(false);
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
            {confirmedRows.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography
                        variant="subtitle2"
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', mb: confirmedOpen ? 1 : 0 }}
                        onClick={() => setConfirmedOpen(o => !o)}
                    >
                        <IconButton size="small" sx={{ p: 0 }}>
                            {confirmedOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </IconButton>
                        Confirmed ({confirmedRows.length})
                    </Typography>
                    <Collapse in={confirmedOpen}>
                        <CrossCheckSection
                            title="Confirmed"
                            rows={confirmedRows}
                            confirmed
                            hideHeading
                            pids={pids}
                            onOpenAuthor={onOpenAuthor}
                            onSearchAuthor={onSearchAuthor}
                            onUndo={onUndo}
                            sharedMaps={sharedMaps}
                            activeCustomProfileIds={activeCustomProfileIds}
                        />
                    </Collapse>
                </Box>
            )}
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
