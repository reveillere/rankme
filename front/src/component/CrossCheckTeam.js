import { useEffect, useMemo, useRef, useState } from 'react';

// Material-UI Components
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import UploadIcon from '@mui/icons-material/Upload';

// DBLP/HAL
import { fetchTeamCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { postIdentityLink, importIdentityLinks } from '../identityResolution';
import { getTeam } from '../teamStore';
import { dblpCategories } from '../dblp';
import { getHalCategory } from '../hal';
import { PublicationRow } from './Publications';
import { HalPublicationRow } from './HalPublications';
import { IdentityLinkDialog } from './IdentityLinkDialog';
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

// Team-scope sibling of CrossCheck.js (single-author DBLP -> HAL crosscheck)
// -- see api/src/crosscheckTeam.js. Deliberately NOT sharing CrossCheck.js's
// own CrossCheckSection/withRowNumbers (neither is exported, and CrossCheck.js
// itself is out of scope for this feature): the row/section rendering below
// is a close copy, adapted to run once per resolved team member instead of
// once for the whole page, plus a member column in the CSV export and an
// extra section for members no HAL identity could be found for. See
// CrossCheck.js for why each of the small pieces (ACTION_WIDTH/CHIP_WIDTH,
// NO_SELF_IDS, the DBLP-grey/HAL-below layout) look the way they do.
const NO_SELF_IDS = [];
const ACTION_WIDTH = 76;
const CHIP_WIDTH = 92;

// A rankme "team" has no server-side existence at all (front/src/teamStore.js,
// localStorage only) -- teamId only ever resolves client-side, so this reads
// it the same way Team.js does before doing anything else, including for a
// tab reopened from a bare /crosscheck/team/:teamId URL.
export function CrossCheckTeam({ teamId, onOpenAuthor, onSearchAuthor, isActive }) {
    const team = getTeam(teamId);

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
    // The unresolved member (report.unresolvedMembers entry) currently being
    // linked by hand via the dialog below, or null -- see handleManualLink.
    // Kept as the whole object (not just one id) because which id it already
    // knows (pid for a dblp-sourced team, idHal for a hal-sourced one) and
    // the direction to search (the opposite one) both depend on team.source.
    const [linkingMember, setLinkingMember] = useState(null);
    // Shown up front, before the missing/to-review results, the first time
    // this team's report loads (i.e. right when landing on the page from
    // the "Cross-check with HAL" click) if it has members no HAL identity
    // could be found for -- but never again after that: a confirm/reject
    // click elsewhere bumps refreshToken and refetches `report`, and the
    // popup should not jump back in front of what the maintainer is doing
    // just because that refetch still has the same unresolved members.
    // hasShownOnceRef (not state) is what makes this a one-shot instead of
    // reopening on every `report` change -- see the effect below.
    const [unresolvedPopupOpen, setUnresolvedPopupOpen] = useState(false);
    const importLinksFileInputRef = useRef();
    const { conferenceSource, journalSource } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();

    const pids = useMemo(() => team.members.map(m => m.id), [team]);
    const identityMembers = useMemo(() => team.members.map(member => ({ id: member.id, name: member.label })), [team.members]);
    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );

    // Name-only suggestion fed to the manual-link dialog below -- same
    // reasoning as CrossCheckStructure.js's own linkingSuggestion: a named
    // suggestion makes IdentityLinkDialog search by name up front instead of
    // opening blank. Memoized on linkingMember's own name (a primitive) so
    // this doesn't get rebuilt into a fresh object -- and retrigger
    // IdentityLinkDialog's pre-fill effect -- on every unrelated re-render
    // while the dialog stays open.
    const linkingSuggestion = useMemo(
        () => (linkingMember?.name ? { name: linkingMember.name } : undefined),
        [linkingMember?.name]
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

    // Confirmed the same way Author.js's own handleCrossCheckConfirm does:
    // always writes 'manual' server-side (see identityResolution.js's
    // controllerRecordLink), regardless of whether the id came from a fresh
    // search or a manual entry in the dialog -- the single-candidate case
    // (see UnresolvedTeamMemberRow below) never opens this dialog at all, it
    // calls postIdentityLink directly via handleConfirmCandidate instead.
    const handleManualLink = (chosenId) => {
        const member = linkingMember;
        setLinkingMember(null);
        const { idHal, pid } = team.source === 'dblp' ? { idHal: chosenId, pid: member.pid } : { idHal: member.idHal, pid: chosenId };
        postIdentityLink({ idHal, pid })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

    // One-click confirmation for a member with exactly one candidate already
    // found (see UnresolvedTeamMemberRow below) -- no dialog, straight to
    // the same write handleManualLink's dialog path ends up making.
    const handleConfirmCandidate = (member, candidateId) => {
        const { idHal, pid } = team.source === 'dblp' ? { idHal: candidateId, pid: member.pid } : { idHal: member.idHal, pid: candidateId };
        postIdentityLink({ idHal, pid })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

    // Same JSON-file mechanics as IdentityLinksPanel.js's own import (which
    // in turn mirrors Teams.js's handleImportTeamsFile) -- lets the
    // maintainer resolve several unresolved members at once from a
    // previously exported/hand-built links file, right here in the popup
    // that already lists them.
    // Reload the complete report after importing identity links.
    const handleImportLinksFile = (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try {
                parsed = JSON.parse(String(reader.result));
            } catch {
                setError(new Error('Invalid JSON file'));
                return;
            }
            const list = Array.isArray(parsed) ? parsed : [parsed];
            importIdentityLinks(list)
                .then(() => setRefreshToken(t => t + 1))
                .catch(err => setError(err));
        };
        reader.readAsText(file);
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

    // The direction to search in the manual-link dialog is always the
    // opposite of what the team already supplied: a dblp-sourced team knows
    // every member's pid up front and is missing idHal (search HAL), a
    // hal-sourced one knows idHal and is missing pid (search DBLP).
    const linkDirection = team.source === 'dblp' ? 'hal' : 'dblp';
    const linkingKnownLabel = linkingMember && (team.source === 'dblp' ? `pid: ${linkingMember.pid}` : `idHal: ${linkingMember.idHal}`);

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

            {/* Shown up front (before the per-member Missing/To-review
                sections below) whenever the latest report still has
                unresolved members -- see unresolvedPopupOpen's own comment.
                "View results" just closes it without discarding anything:
                unresolved members remain listed at the bottom of the page
                too (not only here), so nothing is lost by dismissing. */}
            {false && <Dialog open={unresolvedPopupOpen} onClose={() => setUnresolvedPopupOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Members without a resolved {targetLabel} identity ({report.unresolvedMembers.length})</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        These team members couldn&apos;t be automatically matched to a {targetLabel} identity, so their publications aren&apos;t included in the results below yet.
                    </Typography>
                    <Box sx={{ mb: 2 }}>
                        <Tooltip title='Expected JSON format: an array of {"idHal": "...", "pid": "..."} objects (or a single such object).'>
                            <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => importLinksFileInputRef.current?.click()} sx={{ textTransform: 'none' }}>
                                Import links
                            </Button>
                        </Tooltip>
                        <input ref={importLinksFileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportLinksFile} />
                    </Box>
                    {report.unresolvedMembers.map(m => (
                        <UnresolvedTeamMemberRow key={m.pid || m.idHal} member={m} source={team.source} onLinkManually={() => setLinkingMember(m)} onConfirmCandidate={handleConfirmCandidate} />
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUnresolvedPopupOpen(false)}>View results</Button>
                </DialogActions>
            </Dialog>}

            {false && report.unresolvedMembers.length > 0 && (
                <Box sx={{ maxWidth: 900, margin: '0 auto 30px' }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>Members without a resolved {targetLabel} identity ({report.unresolvedMembers.length})</Typography>
                    {report.unresolvedMembers.map(m => (
                        <UnresolvedTeamMemberRow key={m.pid || m.idHal} member={m} source={team.source} onLinkManually={() => setLinkingMember(m)} onConfirmCandidate={handleConfirmCandidate} />
                    ))}
                </Box>
            )}

            <IdentityLinkDialog
                open={linkingMember !== null}
                onClose={() => setLinkingMember(null)}
                onConfirm={handleManualLink}
                direction={linkDirection}
                title={linkDirection === 'hal' ? 'Cross-check with HAL' : 'Link DBLP identity'}
                description={linkingMember && `Find ${linkingMember.name || linkingKnownLabel}'s ${targetLabel} identity (${linkingKnownLabel}) to list their publications with no matching ${team.source === 'dblp' ? 'HAL deposit' : 'DBLP record'}.`}
                suggestion={linkingSuggestion}
            />

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {report.confirmedCount} confirmed, not shown
            </Typography>
        </div>
    );
}

// One row of the "unresolved members" listing, shared between the one-shot
// popup and the always-present bottom section -- generalizes over both team
// directions: a dblp-sourced member already knows its pid and is missing an
// idHal (candidateIdHal/candidateName, found by resolveHalIdentityForPid's
// own single-shot ORCID lookup -- see api/src/crosscheckTeam.js), a
// hal-sourced one is the mirror image (candidatePid/candidateName). Either
// way there is at most one candidate (unlike CrossCheckStructure.js's own
// name/token search, which can find several) -- so "exactly one candidate"
// here just means "candidate present", and gets a direct one-click Confirm
// instead of opening the manual-link dialog at all.
function UnresolvedTeamMemberRow({ member, source, onLinkManually, onConfirmCandidate }) {
    const knownId = source === 'dblp' ? member.pid : member.idHal;
    const knownLabel = source === 'dblp' ? 'pid' : 'idHal';
    const candidateId = source === 'dblp' ? member.candidateIdHal : member.candidatePid;
    const candidateLabel = source === 'dblp' ? 'idHal' : 'pid';
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
                {member.name || knownId} ({knownLabel}: {knownId})
                {candidateId && <><br /> — candidate: <strong>{member.candidateName || candidateId}</strong> ({candidateLabel}: {candidateId})</>}
            </Typography>
            {candidateId ? (
                <Button size="small" variant="contained" onClick={() => onConfirmCandidate(member, candidateId)} sx={{ textTransform: 'none' }}>
                    Confirm
                </Button>
            ) : (
                <Button size="small" variant="outlined" onClick={onLinkManually} sx={{ textTransform: 'none' }}>
                    Link {candidateLabel === 'idHal' ? 'HAL' : 'DBLP'} identity
                </Button>
            )}
        </Box>
    );
}

// One resolved member's own Missing/To-review sections, under a subtitle
// naming them -- see CrossCheck.js's own withRowNumbers for the numbering
// rule this mirrors, here scoped to just this member's own results so a
// number still means "Nth item of this type among this member's own
// publications", not something meaningless spanning several different
// people's dblp records.
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

// Close copy of CrossCheck.js's own CrossCheckSection -- see that file's
// comments for why the DBLP-row-greyed-out-above/HAL-candidates-below
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
