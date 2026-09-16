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
import { fetchStructureCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { postIdentityLink, importIdentityLinks } from '../identityResolution';
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

export function CrossCheckStructure({ structId, structureName, onOpenAuthor, onSearchAuthor, isActive }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    // Bumped after a confirm/reject click or a manual identity link lands,
    // to force the effect below to refetch -- same reasoning as
    // CrossCheckTeam.js's own refreshToken.
    const [refreshToken, setRefreshToken] = useState(0);
    // idHal of the unresolved member currently being linked by hand, or null
    // -- drives the single shared IdentityLinkDialog below (direction="dblp",
    // see handleManualLink). idHal, not pid, since for a structure member the
    // HAL identity is already known (they're on file as a lab member) --
    // it's the DBLP pid that's missing, the opposite of CrossCheckTeam.js's
    // own linkingMember.
    const [linkingIdHal, setLinkingIdHal] = useState(null);
    // Same one-shot popup as CrossCheckTeam.js -- see its own hasShownOnceRef
    // comment for why this must not reopen on every refetch.
    const [unresolvedPopupOpen, setUnresolvedPopupOpen] = useState(false);
    const hasShownOnceRef = useRef(false);
    const importLinksFileInputRef = useRef();
    const { conferenceSource, journalSource } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();

    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );

    // Name-only suggestion fed to the manual-link dialog below, so opening it
    // for a member who already has DBLP candidates (identityResolution.js's
    // own name/token search) makes those same candidates resurface as
    // ordinary ranked search results instead of a separate row of
    // quick-select buttons -- see IdentityLinkDialog's own comment for why
    // that block was dropped. Memoized on the member's own name (a
    // primitive), not rebuilt as a fresh object on every render, so it
    // doesn't retrigger IdentityLinkDialog's pre-fill effect (keyed on the
    // `suggestion` reference itself) on every unrelated re-render while the
    // dialog stays open -- declared here, ahead of the early returns below,
    // since a Hook must run on every render regardless of whether `report`
    // has loaded yet.
    const linkingMemberName = linkingIdHal && report ? report.unresolvedMembers.find(m => m.idHal === linkingIdHal)?.name : null;
    const linkingSuggestion = useMemo(
        () => (linkingMemberName ? { name: linkingMemberName } : undefined),
        [linkingMemberName]
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

    useEffect(() => {
        if (!report || hasShownOnceRef.current) return;
        hasShownOnceRef.current = true;
        setUnresolvedPopupOpen(report.unresolvedMembers.length > 0);
    }, [report]);

    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

    const handleManualLink = (pid) => {
        const idHal = linkingIdHal;
        setLinkingIdHal(null);
        postIdentityLink({ idHal, pid })
            .then(() => removeUnresolvedMember(idHal))
            .catch(err => setError(err));
    };

    // One-click confirmation for a member with exactly one candidate already
    // found by identityResolution.js's own name/token search (see
    // UnresolvedMemberRow below) -- no dialog, straight to the same write
    // handleManualLink's dialog path ends up making.
    const handleConfirmCandidate = (idHal, pid) => {
        postIdentityLink({ idHal, pid })
            .then(() => removeUnresolvedMember(idHal))
            .catch(err => setError(err));
    };

    // Optimistic local update, not a refreshToken-triggered refetch: this
    // report's own endpoint (getStructureCrossCheckReport, see
    // api/src/crosscheckStructure.js) caches the WHOLE aggregated report for
    // 1h. Bumping refreshToken right after a successful postIdentityLink
    // write would just re-fetch that same stale cached report, with this
    // member still listed as unresolved -- the write lands, but the popup
    // and its count never reflect it until the cache naturally expires. So
    // instead this strips the confirmed member out of `report.unresolvedMembers`
    // directly, which is enough to make the popup/section/count update right
    // away. What this does NOT do is synthesize the member's own resolved
    // Missing/To-review section in `report.members` -- that needs a real
    // getCrossCheckReport call this component doesn't make on its own, so
    // that section only appears once a later cache expiry or full reload
    // picks it up.
    const removeUnresolvedMember = (idHal) => {
        setReport(prev => prev && ({
            ...prev,
            unresolvedMembers: prev.unresolvedMembers.filter(m => m.idHal !== idHal),
        }));
    };

    // Same JSON-file mechanics as IdentityLinksPanel.js's own import (which
    // in turn mirrors Teams.js's handleImportTeamsFile) and CrossCheckTeam.js's
    // identical handleImportLinksFile -- lets the maintainer resolve several
    // unresolved members at once from a previously exported/hand-built
    // links file, right here in the popup that already lists them.
    // Bumping refreshToken afterwards is the same refetch handleOverrideDecision
    // above already triggers -- unlike handleManualLink/handleConfirmCandidate,
    // an import can resolve several members from arbitrary rows in the file at
    // once, so there's no small fixed set of idHals to strip out of
    // `unresolvedMembers` locally the way removeUnresolvedMember does for a
    // single confirm; a refetch (still subject to the 1h aggregate cache, see
    // removeUnresolvedMember's own comment) is what's left.
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

    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this structure against HAL. Please try again later.</div>;
    // The member count isn't known up front the way CrossCheckTeam.js's own
    // team.members.length is -- a structure's membership only exists once
    // getStructureCrossCheckReport has resolved it server-side, there is no
    // client-side list to read a count from before that first response lands.
    if (report === null) return <LoadingSpinner message="Cross-checking structure members against HAL…" />;

    const importedAtLabel = report.dblpStatus?.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    const linkingMember = linkingIdHal ? report.unresolvedMembers.find(m => m.idHal === linkingIdHal) : null;

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

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <div style={{ textAlign: 'center', marginTop: '40px', marginBottom: '20px' }}>
                <h1>DBLP → HAL cross-check for {title}</h1>
            </div>

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

            {/* Shown up front (before the per-member Missing/To-review
                sections below) whenever the latest report still has
                unresolved members -- see unresolvedPopupOpen's own comment.
                "View results" just closes it without discarding anything:
                unresolved members remain listed at the bottom of the page
                too (not only here), so nothing is lost by dismissing. */}
            <Dialog open={unresolvedPopupOpen} onClose={() => setUnresolvedPopupOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Members without a resolved DBLP identity ({report.unresolvedMembers.length})</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        These structure members couldn&apos;t be automatically matched to a DBLP identity, so their publications aren&apos;t included in the results below yet.
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
                        <UnresolvedMemberRow key={m.idHal} member={m} onLink={() => setLinkingIdHal(m.idHal)} onConfirmCandidate={handleConfirmCandidate} />
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUnresolvedPopupOpen(false)}>View results</Button>
                </DialogActions>
            </Dialog>

            {report.unresolvedMembers.length > 0 && (
                <Box sx={{ maxWidth: 900, margin: '0 auto 30px' }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>Members without a resolved DBLP identity ({report.unresolvedMembers.length})</Typography>
                    {report.unresolvedMembers.map(m => (
                        <UnresolvedMemberRow key={m.idHal} member={m} onLink={() => setLinkingIdHal(m.idHal)} onConfirmCandidate={handleConfirmCandidate} />
                    ))}
                </Box>
            )}

            <IdentityLinkDialog
                open={linkingIdHal !== null}
                onClose={() => setLinkingIdHal(null)}
                onConfirm={handleManualLink}
                direction="dblp"
                title="Link DBLP identity"
                description={linkingMember && `Find ${linkingMember.name || linkingMember.idHal}'s DBLP identity (idHal: ${linkingMember.idHal}) to list their publications with no matching HAL deposit.`}
                suggestion={linkingSuggestion}
            />

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {report.confirmedCount} confirmed, not shown
            </Typography>
        </div>
    );
}

// One row of the "unresolved members" listing, shared between the one-shot
// popup and the always-present bottom section. A member with exactly one
// candidate already found by identityResolution.js's own name/token search
// gets a direct one-click Confirm instead of opening the manual-link dialog
// at all (see CrossCheckTeam.js's own UnresolvedTeamMemberRow for the same
// pattern in the other report) -- for 0 or several candidates, "Link DBLP
// identity" still opens the dialog, now pre-filled with this member's own
// name (linkingSuggestion above) so the same candidates resurface as
// ordinary ranked search results instead of a separate row of buttons.
function UnresolvedMemberRow({ member, onLink, onConfirmCandidate }) {
    const singleCandidate = member.candidates.length === 1 ? member.candidates[0] : null;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
                {member.name || member.idHal} (idHal: {member.idHal})
                {singleCandidate && <><br /> — candidate: <strong>{singleCandidate.name || singleCandidate.pid}</strong> (pid: {singleCandidate.pid})</>}
                {!singleCandidate && member.candidates.length > 0 && <><br /> — {member.candidates.length} DBLP candidates found (unconfirmed)</>}
            </Typography>
            {singleCandidate ? (
                <Button size="small" variant="contained" onClick={() => onConfirmCandidate(member.idHal, singleCandidate.pid)} sx={{ textTransform: 'none' }}>
                    Confirm
                </Button>
            ) : (
                <Button size="small" variant="outlined" onClick={onLink} sx={{ textTransform: 'none' }}>
                    Link DBLP identity
                </Button>
            )}
        </Box>
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
