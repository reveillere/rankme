import { useEffect, useMemo, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';

// DBLP/HAL
import { fetchStructureCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { dblpCategories } from '../dblp';
import { getHalCategory } from '../hal';
import { PublicationRow } from './Publications';
import { HalPublicationRow } from './HalPublications';
import { customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { exportCrossCheckByMemberMarkdown, exportCrossCheckByMemberJson } from '../exportCrossCheck';

// Components
import { LoadingSpinner } from './LoadingSpinner';
import { ExportButton } from './ExportButton';
import { IdentityLinksPanel } from './IdentityLinksPanel';
import { CrossCheckIdentityHeader } from './CrossCheckIdentityHeader';

import '../App.css';

// Structure-scope sibling of CrossCheck.js/CrossCheckTeam.js (see
// api/src/crosscheckStructure.js). Unlike a rankme "team" (client-side only,
// see CrossCheckTeam.js's own comment), a HAL structure has a stable
// server-side structId and its whole membership is already resolved by
// identityResolution.js's own name/orcid pipeline (getStructureCrossCheckReport
// attaches a real `name` to every member, resolved or not) -- so this takes
// structId directly as a prop instead of reading a client-side store, and
// its network call is a plain GET keyed by structId, no member list to send.
//
// The row/section rendering below (CrossCheckSection/withRowNumbers,
// ACTION_WIDTH/CHIP_WIDTH, the DBLP-grey/HAL-below layout) is a close copy
// of CrossCheckTeam.js's own -- deliberately duplicated rather than shared,
// same choice CrossCheckTeam.js itself already made against CrossCheck.js.
const NO_SELF_IDS = [];
const ACTION_WIDTH = 76;
const CHIP_WIDTH = 92;

export function CrossCheckStructure({ structId, structureName, onOpenAuthor, onSearchAuthor }) {
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

    const handleExportCsv = () => exportCsv(structId, report.members);
    const title = structureName || structId;
    const memberLabel = member => `${member.name || member.idHal} (idHal: ${member.idHal}, pid: ${member.pid})`;
    const handleExportMarkdown = () => exportCrossCheckByMemberMarkdown({
        title: `DBLP → HAL cross-check for ${title}`,
        filename: `crosscheck-structure-${structId}.md`,
        members: report.members,
        memberLabel,
    });
    const handleExportJson = () => exportCrossCheckByMemberJson({
        title: `DBLP → HAL cross-check for ${title}`,
        filename: `crosscheck-structure-${structId}.json`,
        members: report.members,
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

            {report.members.map(member => (
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
                {report.confirmedCount} confirmed, not shown
            </Typography>
        </div>
    );
}

// One resolved member's own Missing/To-review sections -- see
// CrossCheckTeam.js's identical withRowNumbers for the numbering rule this
// mirrors, here scoped to just this member's own results.
function withRowNumbers(results) {
    const typeCounts = results.reduce((acc, r) => {
        acc[r.publication.type] = (acc[r.publication.type] || 0) + 1;
        return acc;
    }, {});
    return results.map(result => ({
        result,
        nr: dblpCategories[result.publication.type].letter + typeCounts[result.publication.type]--,
    }));
}

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

// Close copy of CrossCheckTeam.js's own CrossCheckSection -- see
// CrossCheck.js for why the DBLP-row-greyed-out-above/HAL-candidates-below
// layout, the confirm/reject icon pair, and the ACTION_WIDTH/CHIP_WIDTH
// spacer widths look the way they do.
function CrossCheckSection({ title, description, rows, showCandidates, pids, onOpenAuthor, onSearchAuthor, onDecide, sharedMaps, activeCustomProfileIds }) {
    return (
        <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: description ? 0.5 : 1 }}>{title} ({rows.length})</Typography>
            {description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{description}</Typography>
            )}
            {rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">None</Typography>
            ) : showCandidates ? (
                rows.map(({ result }, i) => (
                    <Box key={result.publication.dblp.key}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, opacity: 0.55 }}>
                            <Box sx={{ width: ACTION_WIDTH, flexShrink: 0 }} />
                            <Chip label={`DBLP ${result.publication.dblp.year}`} size="small" sx={{ mt: '4px', flexShrink: 0, width: CHIP_WIDTH }} />
                            <ul className="publ-list" style={{ flex: 1, margin: 0 }}>
                                <li className={`entry ${result.publication.type}`}>
                                    <PublicationRow item={result.publication} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
                                </li>
                            </ul>
                        </Box>
                        {result.matches.map(m => {
                            const category = getHalCategory(m.halPub.type);
                            return (
                                <Box key={m.halPub.docid} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1 }}>
                                    <Box sx={{ width: ACTION_WIDTH, flexShrink: 0, display: 'flex', mt: '2px' }}>
                                        <Tooltip title="Confirm same paper">
                                            <IconButton
                                                size="small"
                                                onClick={() => onDecide(result.publication.dblp.key, m.halPub.docid, 'same')}
                                            >
                                                <CheckCircleOutlineIcon fontSize="small" color="success" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Not the same paper">
                                            <IconButton
                                                size="small"
                                                onClick={() => onDecide(result.publication.dblp.key, m.halPub.docid, 'different')}
                                            >
                                                <HighlightOffIcon fontSize="small" color="error" />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                    <Chip label={`HAL ${m.halPub.year || '—'}`} size="small" color="info" sx={{ mt: '4px', flexShrink: 0, width: CHIP_WIDTH }} />
                                    <ul className="publ-list" style={{ flex: 1, margin: 0 }}>
                                        <li className={`entry ${category.cssClass}`}>
                                            <HalPublicationRow
                                                item={m.halPub}
                                                category={category}
                                                selfIds={NO_SELF_IDS}
                                                onOpenAuthor={onOpenAuthor}
                                                onSearchAuthor={onSearchAuthor}
                                                sharedMaps={sharedMaps}
                                                activeCustomProfileIds={activeCustomProfileIds}
                                            />
                                        </li>
                                    </ul>
                                </Box>
                            );
                        })}
                        {i < rows.length - 1 && <Divider sx={{ my: 2 }} />}
                    </Box>
                ))
            ) : (
                <ul className="publ-list">
                    {rows.map(({ result, nr }) => (
                        <li className={`entry ${result.publication.type}`} key={result.publication.dblp.key}>
                            <PublicationRow item={result.publication} nr={nr} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
                        </li>
                    ))}
                </ul>
            )}
        </Box>
    );
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
