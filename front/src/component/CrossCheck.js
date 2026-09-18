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
import { fetchCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { exportCrossCheckMarkdown, exportCrossCheckJson } from '../exportCrossCheck';

// Components
import { LoadingSpinner } from './LoadingSpinner';
import { ReportButton } from './ReportButton';
import { CrossCheckSection, withRowNumbers, csvEscape } from './CrossCheckSection';

import '../App.css';
import { applyLocalDecisions, listIdentityLinks, removeCrosscheckDecision, LINKS_KEY } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { IdentityLinksIconButton } from './IdentityLinksIconButton';
import { CrosscheckDecisionFileButtons } from './CrosscheckDecisionsButton';

const yearAccessor = result => parseInt(result.publication.dblp.year, 10) || 0;

// Unlike CrossCheckStructure.js/CrossCheckTeam.js's own CrossCheckSection
// calls (nested inside their own per-member section, which already provides
// an outer width/margin), this page renders CrossCheckSection directly, so
// it needs its own top-level width/margin -- see CrossCheckSection.js's own
// boxSx/headingVariant comment. Module-level so it stays referentially
// stable across renders, same reasoning as NO_SELF_IDS there.
const SECTION_BOX_SX = { maxWidth: 900, margin: '0 auto 30px' };

// DBLP -> HAL crosscheck report for one (pid, halId) pair -- see
// api/src/crosscheck.js for the matching itself. Opened as its own tab from
// Author.js's "Cross-check with HAL" button (or a shared/reloaded
// /crosscheck/dblp/:pid/hal/:halId URL, see App.js's tabFromPath).
//
// yearRange comes from the DBLP author page's own year filter, active at
// the moment the user clicked "Cross-check with HAL" (see Author.js's
// handleCrossCheckConfirm) -- this page deliberately has no year control of
// its own any more (it used to have an independent DateRangeSlider
// defaulting to the last 10 years, which the maintainer found confusing:
// two different "last N years" filters on two pages showing the same
// author's publications, with no reason to ever disagree). Absent/invalid
// (e.g. a /crosscheck/... URL reloaded without its ?from=&to= query, or
// shared before this range even existed) means "don't filter" rather than
// crashing -- see App.js's tabFromPath for how the URL carries it.
export function CrossCheck({ pid, halId, yearRange, onOpenAuthor, onSearchAuthor }) {
    const [automaticReport, setReport] = useState(null);
    const personalVersion = usePersonalDataVersion();
    const identityVersion = usePersonalDataVersion(LINKS_KEY);
    const effectiveHalId = listIdentityLinks({ pids: [pid] })[0]?.idHal || halId;
    // Personal storage changes invalidate the derived report without refetching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const report = useMemo(() => automaticReport && applyLocalDecisions(automaticReport), [automaticReport, personalVersion]);
    const [error, setError] = useState(null);
    // Identity edits can require a new automatic report; decisions are local.
    // Collapsed by default -- a decided-confirmed row is the exception, not
    // the common case, and most reports have none at all.
    const [confirmedOpen, setConfirmedOpen] = useState(false);
    const { conferenceSource, journalSource } = useFilterSettings();
    const sharedMaps = useSharedOverridesMaps();

    // Stable across renders unless pid itself changes -- see Publications.js's
    // PublicationRow, whose React.memo this would otherwise defeat for every
    // row on every render (same reasoning as Publications()'s own `pids`).
    const pids = useMemo(() => [pid], [pid]);
    const activeCustomProfileIds = useMemo(
        () => ({ conference: customProfileIdFrom(conferenceSource), journal: customProfileIdFrom(journalSource) }),
        [conferenceSource, journalSource]
    );

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

    const results = report?.results;

    const hasYearRange = Array.isArray(yearRange) && yearRange.length === 2 && Number.isFinite(yearRange[0]) && Number.isFinite(yearRange[1]);

    if (error) return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to cross-check this author against HAL. Please try again later.</div>;
    if (report === null) return <LoadingSpinner message="Cross-checking DBLP against HAL…" />;

    const filtered = !hasYearRange ? results : results.filter(r => {
        const y = yearAccessor(r);
        return y >= yearRange[0] && y <= yearRange[1];
    });
    // Numbered once across the whole (year-)filtered list -- not per
    // section -- so e.g. "[j1]" means the same thing it would on the
    // regular author page (oldest journal article in the current view),
    // rather than "the only journal article that happens to be missing/to
    // review", which looked like a wrong/confusing number to the maintainer
    // (a single to-review item always showed as "[j1]" regardless of its
    // real position among this author's journal articles).
    const numbered = withRowNumbers(filtered);
    const missingRows = numbered.filter(({ result }) => result.status === 'missing');
    const toReviewRows = numbered.filter(({ result }) => result.status === 'to-review');
    // A decided-confirmed row (a manual click, or an imported decision file)
    // is surfaced with an undo below; a 'confirmed' row statusFromMatches
    // (api/src/crosscheck.js) produced on its own -- an exact DOI/arXiv or
    // strong title+year match, no local decision behind it -- is not: there
    // can be hundreds of those, and there is nothing to undo.
    const confirmedRows = numbered.filter(({ result }) => result.status === 'confirmed' && result.decided);
    const automaticConfirmedCount = filtered.length - missingRows.length - toReviewRows.length - confirmedRows.length;

    const importedAtLabel = report.dblpStatus.importedAt
        ? new Date(report.dblpStatus.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    const handleExportCsv = () => exportCsv(pid, filtered);
    const handleExportMarkdown = () => exportCrossCheckMarkdown({
        title: `DBLP → HAL cross-check for ${pid}`,
        filename: `crosscheck-${pid.replace(/\//g, '-')}.md`,
        results: filtered,
    });
    const handleExportJson = () => exportCrossCheckJson({
        title: `DBLP → HAL cross-check for ${pid}`,
        filename: `crosscheck-${pid.replace(/\//g, '-')}.json`,
        results: filtered,
    });

    return (
        <div className='App' style={{ padding: '0 40px' }}>
            <div style={{ textAlign: 'center', marginTop: '40px', marginBottom: '20px' }}>
                <h1>DBLP → HAL cross-check</h1>
                <div style={{ fontStyle: 'italic', fontSize: 'small', color: '#8a8f94' }}>
                    pid: {pid} · idHal: {effectiveHalId}
                </div>
            </div>

            <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
                {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                {report.halCacheNote}
            </Alert>

            <Box sx={{ textAlign: 'center', marginBottom: '30px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <IdentityLinksIconButton pids={[pid]} />
                <CrosscheckDecisionFileButtons report={report} scope={{ type: 'author', pid, idHal: effectiveHalId }} />
                <ReportButton title="Cross-check report" onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} />
            </Box>

            <CrossCheckSection title="Missing from HAL" rows={missingRows} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} boxSx={SECTION_BOX_SX} headingVariant="h6" />
            <CrossCheckSection
                title="To review"
                description="These DBLP publications only found an uncertain match in HAL — check whether it's really the same paper before treating it as deposited."
                rows={toReviewRows}
                showCandidates
                pids={pids}
                onOpenAuthor={onOpenAuthor}
                onSearchAuthor={onSearchAuthor}
                onDecide={handleOverrideDecision}
                sharedMaps={sharedMaps}
                activeCustomProfileIds={activeCustomProfileIds}
                boxSx={SECTION_BOX_SX}
                headingVariant="h6"
            />

            {confirmedRows.length > 0 && (
                <Box sx={SECTION_BOX_SX}>
                    <Typography
                        variant="h6"
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
                            onUndo={handleUndo}
                            sharedMaps={sharedMaps}
                            activeCustomProfileIds={activeCustomProfileIds}
                            boxSx={{}}
                        />
                    </Collapse>
                </Box>
            )}

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {automaticConfirmedCount} confirmed automatically, not shown
            </Typography>
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
