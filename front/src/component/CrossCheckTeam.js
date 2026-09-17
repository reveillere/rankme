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

// Components
import { LoadingSpinner } from './LoadingSpinner';
import { ExportButton } from './ExportButton';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { CrossCheckIdentityHeader } from './CrossCheckIdentityHeader';
import { CrossCheckSection, withRowNumbers, csvEscape } from './CrossCheckSection';

import '../App.css';

// Team-scope sibling of CrossCheck.js (single-author DBLP -> HAL crosscheck)
// -- see api/src/crosscheckTeam.js. The row/section rendering below is
// adapted to run once per resolved team member instead of once for the
// whole page, plus a member column in the CSV export.

// A rankme "team" has no server-side existence at all (front/src/teamStore.js,
// localStorage only) -- teamId only ever resolves client-side, so this reads
// it the same way Team.js does before doing anything else, including for a
// tab reopened from a bare /crosscheck/team/:teamId URL.
export function CrossCheckTeam({ teamId, onOpenAuthor, onSearchAuthor, isActive }) {
    // getTeam reads and parses localStorage. Keep this snapshot stable for the
    // lifetime of this route: otherwise every state update creates a new
    // members array, retriggers the fetching effect below and clears the
    // report before it can ever be displayed.
    const team = useMemo(() => getTeam(teamId), [teamId]);

    if (!team) {
        return <div style={{ textAlign: 'center', marginTop: '80px' }}>This team no longer exists.</div>;
    }

    return <CrossCheckTeamShow team={team} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} isActive={isActive} />;
}

function CrossCheckTeamShow({ team, onOpenAuthor, onSearchAuthor }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    // Bumped after a confirm/reject click or a manual identity link lands,
    // to force the effect below to refetch -- same reasoning as CrossCheck.js's
    // own refreshToken.
    const [refreshToken, setRefreshToken] = useState(0);
    const [identityPanelOpen, setIdentityPanelOpen] = useState(true);
    const { conferenceSource, journalSource } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();

    const pids = useMemo(() => team.members.map(m => m.id), [team]);
    const identityMembers = useMemo(() => team.members.map(member => ({ id: member.id, name: member.label })), [team.members]);
    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchTeamCrossCheck({ source: team.source, pids }, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [team.id, team.source, pids, conferenceSource, journalSource, refreshToken]);

    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

    const targetLabel = team.source === 'dblp' ? 'HAL' : 'DBLP';
    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this team against {targetLabel}. Please try again later.</div>;
    if (report === null) return <>
        <IdentityLinksPanel open={identityPanelOpen} onClose={() => setIdentityPanelOpen(false)} onViewResults={() => setIdentityPanelOpen(false)} teamSource={team.source} teamMembers={identityMembers} onLinksChanged={() => setRefreshToken(t => t + 1)} />
        <LoadingSpinner message={`Cross-checking ${team.members.length} members against ${targetLabel}…`} />
    </>;

    const importedAtLabel = report.dblpStatus?.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    const handleExportCsv = () => exportCsv(team, report.members);
    const memberLabel = member => `${member.name || member.pid} (pid: ${member.pid}, idHal: ${member.idHal})`;
    const handleExportMarkdown = () => exportCrossCheckByMemberMarkdown({
        title: `DBLP → HAL cross-check for ${team.name}`,
        filename: `crosscheck-team-${team.id}.md`,
        members: report.members,
        memberLabel,
    });
    const handleExportJson = () => exportCrossCheckByMemberJson({
        title: `DBLP → HAL cross-check for ${team.name}`,
        filename: `crosscheck-team-${team.id}.json`,
        members: report.members,
        memberLabel,
    });

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <CrossCheckIdentityHeader title={`DBLP → HAL cross-check for ${team.name}`} scope="Team" members={team.members.map(member => ({ id: member.id, label: member.label, idKind: team.source === 'hal' ? 'idHal' : 'pid' }))} unresolvedCount={report.unresolvedMembers.length} targetLabel={targetLabel} panelOpen={identityPanelOpen} setPanelOpen={setIdentityPanelOpen} panelProps={{ teamSource: team.source, teamMembers: identityMembers }} onLinksChanged={() => setRefreshToken(t => t + 1)} />

            {(importedAtLabel || report.halCacheNote) && (
                <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
                    {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                    {report.halCacheNote}
                </Alert>
            )}

            <Box sx={{ textAlign: 'center', marginBottom: '30px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <ExportButton onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={report.members.length === 0} />
            </Box>

            {report.members.length === 0 && report.unresolvedMembers.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>No members in this team</Typography>
            )}

            {report.members.map(member => (
                <TeamMemberSection
                    key={member.pid}
                    member={member}
                    onOpenAuthor={onOpenAuthor}
                    onSearchAuthor={onSearchAuthor}
                    onDecide={handleOverrideDecision}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
                />
            ))}

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {report.confirmedCount} confirmed, not shown
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
function TeamMemberSection({ member, onOpenAuthor, onSearchAuthor, onDecide, sharedMaps, activeCustomProfileIds }) {
    const pids = useMemo(() => [member.pid], [member.pid]);
    const numbered = withRowNumbers(member.results);
    const missingRows = numbered.filter(({ result }) => result.status === 'missing');
    const toReviewRows = numbered.filter(({ result }) => result.status === 'to-review');

    return (
        <Box sx={{ maxWidth: 900, margin: '0 auto 40px' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Publications for {member.name || member.pid} (pid: {member.pid}, idHal: {member.idHal})
            </Typography>
            <CrossCheckSection title="Missing from HAL" rows={missingRows} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
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
