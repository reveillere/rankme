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

// Components
import { LoadingSpinner } from './LoadingSpinner';
import { ExportButton } from './ExportButton';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { CrossCheckIdentityHeader } from './CrossCheckIdentityHeader';
import { CrossCheckSection, withRowNumbers, csvEscape } from './CrossCheckSection';

import '../App.css';

// Structure-scope sibling of CrossCheck.js/CrossCheckTeam.js (see
// api/src/crosscheckStructure.js). Unlike a rankme "team" (client-side only,
// see CrossCheckTeam.js's own comment), a HAL structure has a stable
// server-side structId and its whole membership is already resolved by
// identityResolution.js's own name/orcid pipeline (getStructureCrossCheckReport
// attaches a real `name` to every member, resolved or not) -- so this takes
// structId directly as a prop instead of reading a client-side store, and
// its network call is a plain GET keyed by structId, no member list to send.

// yearRange: see CrossCheck.js's identical comment -- the structure page's
// own year filter (Structure.js), active at the moment "Cross-check with
// HAL" was clicked. Applied per-member (see filteredMembers below) rather
// than to a single flat list, since each member carries their own results.
const yearAccessor = r => parseInt(r.publication.dblp.year, 10) || 0;

export function CrossCheckStructure({ structId, structureName, onOpenAuthor, onSearchAuthor, yearRange }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    // Bumped after a confirm/reject click or a manual identity link lands,
    // to force the effect below to refetch -- same reasoning as
    // CrossCheckTeam.js's own refreshToken.
    const [refreshToken, setRefreshToken] = useState(0);
    // A cross-check starts with the same identity-resolution dialog available
    // from the structure page. It can be revisited from the header icon.
    const [identityPanelOpen, setIdentityPanelOpen] = useState(true);
    const { conferenceSource, journalSource } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();

    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchStructureCrossCheck(structId, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [structId, conferenceSource, journalSource, refreshToken]);

    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this structure against HAL. Please try again later.</div>;
    // The member count isn't known up front the way CrossCheckTeam.js's own
    // team.members.length is -- a structure's membership only exists once
    // getStructureCrossCheckReport has resolved it server-side, there is no
    // client-side list to read a count from before that first response lands.
    if (report === null) return <>
        <IdentityLinksPanel open={identityPanelOpen} onClose={() => setIdentityPanelOpen(false)} onViewResults={() => setIdentityPanelOpen(false)} structId={structId} onLinksChanged={() => setRefreshToken(t => t + 1)} />
        <LoadingSpinner message="Cross-checking structure members against HAL…" />
    </>;

    const importedAtLabel = report.dblpStatus?.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    // See CrossCheck.js's own hasYearRange/filtered -- same "absent/invalid
    // means don't filter" rule. member.results includes 'confirmed' entries
    // too (only missing/to-review are ever rendered, see
    // StructureMemberSection below), so confirmedCount is recomputed from
    // the same filtered set rather than left as the server's unfiltered
    // count -- otherwise "N confirmed, not shown" would count publications
    // the current year range doesn't even include.
    const hasYearRange = Array.isArray(yearRange) && yearRange.length === 2 && Number.isFinite(yearRange[0]) && Number.isFinite(yearRange[1]);
    const filteredMembers = report.members.map(member => {
        const results = !hasYearRange ? member.results : member.results.filter(r => {
            const y = yearAccessor(r);
            return y >= yearRange[0] && y <= yearRange[1];
        });
        return { ...member, results, confirmedCount: results.filter(r => r.status === 'confirmed').length };
    });
    const totalConfirmedCount = filteredMembers.reduce((sum, m) => sum + m.confirmedCount, 0);

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
            <CrossCheckIdentityHeader title={`DBLP → HAL cross-check for ${title}`} scope="Structure" members={allMembers} unresolvedCount={report.unresolvedMembers.length} targetLabel="DBLP" panelOpen={identityPanelOpen} setPanelOpen={setIdentityPanelOpen} panelProps={{ structId }} onLinksChanged={() => setRefreshToken(t => t + 1)} />

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
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>No members in this structure</Typography>
            )}

            {filteredMembers.map(member => (
                <StructureMemberSection
                    key={member.idHal}
                    member={member}
                    onOpenAuthor={onOpenAuthor}
                    onSearchAuthor={onSearchAuthor}
                    onDecide={handleOverrideDecision}
                    sharedMaps={sharedMaps}
                    activeCustomProfileIds={activeCustomProfileIds}
                />
            ))}

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {totalConfirmedCount} confirmed, not shown
            </Typography>
        </div>
    );
}

// One resolved member's own Missing/To-review sections, scoped to just this
// member's own results -- see CrossCheckSection.js's withRowNumbers for the
// numbering rule.
function StructureMemberSection({ member, onOpenAuthor, onSearchAuthor, onDecide, sharedMaps, activeCustomProfileIds }) {
    const pids = useMemo(() => [member.pid], [member.pid]);
    const numbered = withRowNumbers(member.results);
    const missingRows = numbered.filter(({ result }) => result.status === 'missing');
    const toReviewRows = numbered.filter(({ result }) => result.status === 'to-review');

    return (
        <Box sx={{ maxWidth: 900, margin: '0 auto 40px' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                Publications for {member.name || member.idHal} (idHal: {member.idHal}, pid: {member.pid})
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
