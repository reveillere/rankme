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
import { fetchCrossCheck, postCrossCheckOverride } from '../crosscheck';
import { dblpCategories } from '../dblp';
import { getHalCategory } from '../hal';
import { PublicationRow } from './Publications';
import { HalPublicationRow } from './HalPublications';
import { customProfileIdFrom } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';
import { exportCrossCheckMarkdown, exportCrossCheckJson } from '../exportCrossCheck';

// Components
import { LoadingSpinner } from './LoadingSpinner';
import { ExportButton } from './ExportButton';

import '../App.css';

const yearAccessor = result => parseInt(result.publication.dblp.year, 10) || 0;

// HalPublicationRow needs a selfIds array to know which author to render as
// "self" rather than a clickable link -- there is no such notion here (a
// crosscheck candidate's authors are all just "someone on this paper", not
// necessarily this page's own dblp author under a HAL identity), so this is
// always empty. A shared, module-level constant (not `[]` inline at the call
// site) so it stays referentially stable across renders -- see
// HalPublicationRow's own React.memo comment (HalPublications.js) for why
// that matters, same reasoning as Structure.js/Team.js's own selfIds.
const NO_SELF_IDS = [];

// Width reserved for the confirm/reject IconButton pair on a HAL candidate
// row -- the DBLP row above it reserves the same empty width (see the
// spacer Box there) purely so both rows' chip+publication content start at
// the same x position, letting the .box/.nr/.rank/cite columns of
// PublicationRow/HalPublicationRow line up visually between the two.
const ACTION_WIDTH = 76;

// Fixed width for the DBLP/HAL chips below -- MUI's Chip otherwise sizes
// itself to its label, and "DBLP 2015" vs "HAL 2013" are rarely the exact
// same number of characters, which would shift everything after the chip
// (and so the .box/.nr/.rank/cite columns) out of alignment between the two
// rows purely based on how many digits/letters that particular year/label
// happens to have.
const CHIP_WIDTH = 92;

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
export function CrossCheck({ pid, halId, yearRange, onOpenAuthor, onSearchAuthor, isActive }) {
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    // Bumped after a confirm/reject click lands (see handleOverrideDecision)
    // to force the effect below to refetch -- overrides are occasional,
    // maintainer-only clicks, so a full report refetch is simpler than
    // reaching into `report` to patch the one affected result optimistically.
    const [refreshToken, setRefreshToken] = useState(0);
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
        fetchCrossCheck(pid, halId, { conferenceSource, journalSource })
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) setError(err); });
        return () => { cancelled = true; };
    }, [pid, halId, conferenceSource, journalSource, refreshToken]);

    // dblpKey/halDocid identify the exact pair a maintainer just clicked
    // confirm/reject on -- see api/src/crosscheckOverrides.js. Errors are
    // surfaced the same way the initial load's own failure is (this page's
    // one `error` state), since a failed write left silent would look to
    // the maintainer like their click confirmed/rejected the pair when it
    // didn't.
    const handleOverrideDecision = (dblpKey, halDocid, decision) => {
        postCrossCheckOverride({ dblpKey, halDocid, decision })
            .then(() => setRefreshToken(t => t + 1))
            .catch(err => setError(err));
    };

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
    const confirmedCount = filtered.length - missingRows.length - toReviewRows.length;

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
                    pid: {pid} · idHal: {halId}
                </div>
            </div>

            <Alert severity="info" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
                {importedAtLabel && <>DBLP dump from {importedAtLabel}. </>}
                {report.halCacheNote}
            </Alert>

            <Box sx={{ textAlign: 'center', marginBottom: '30px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <ExportButton onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} />
            </Box>

            <CrossCheckSection title="Missing from HAL" rows={missingRows} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
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
            />

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2, mb: 4 }}>
                {confirmedCount} confirmed, not shown
            </Typography>
        </div>
    );
}

// nr (e.g. "[j5]") numbers each publication within its own category, most
// recent first, same convention as Publications.js's own row numbering --
// computed once across the whole (year-filtered) report, THEN split into
// Missing/To review, so a number here means the same thing it would on the
// regular author page (e.g. "[j1]" = this author's oldest journal article
// in the current view) instead of just "the only journal article in this
// particular section", which is a meaningless/misleading number one item
// list would always produce. Relies on `results` already arriving sorted
// most-recent-first (matchPublications preserves getDblpPublicationsForCrosscheck's
// own year-desc order from dblpLocal.js).
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

function CrossCheckSection({ title, description, rows, showCandidates, pids, onOpenAuthor, onSearchAuthor, onDecide, sharedMaps, activeCustomProfileIds }) {
    return (
        <Box sx={{ maxWidth: 900, margin: '0 auto 30px' }}>
            <Typography variant="h6" sx={{ mb: description ? 0.5 : 1 }}>{title} ({rows.length})</Typography>
            {description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{description}</Typography>
            )}
            {rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">None</Typography>
            ) : showCandidates ? (
                // "To review" gets its own layout, not the flat <ul> below:
                // the DBLP publication and each HAL candidate it might be the
                // same paper as are stacked vertically (not side by side),
                // each labeled with a DBLP/HAL chip so it's never ambiguous
                // which is which, with the confirm/reject actions to the
                // left of the HAL row they apply to -- the maintainer found
                // the previous single-line-per-candidate layout hard to scan.
                // A Divider separates one DBLP pub (+ its candidates) from
                // the next.
                rows.map(({ result }, i) => (
                    <Box key={result.publication.dblp.key}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, opacity: 0.55 }}>
                            {/* Empty spacer the same width as the confirm/reject
                                IconButton pair below, so the DBLP row's chip
                                (and, past it, PublicationRow's own .box/.rank/
                                cite columns) line up with every HAL candidate
                                row underneath instead of starting further left
                                than they do. */}
                            <Box sx={{ width: ACTION_WIDTH, flexShrink: 0 }} />
                            <Chip label={`DBLP ${result.publication.dblp.year}`} size="small" sx={{ mt: '4px', flexShrink: 0, width: CHIP_WIDTH }} />
                            <ul className="publ-list" style={{ flex: 1, margin: 0 }}>
                                <li className={`entry ${result.publication.type}`}>
                                    {/* No nr here -- see PublicationRow's own
                                        comment: it would sit right next to a HAL
                                        candidate row that never gets one either
                                        (a number computed over just the handful
                                        of publications in this section would be
                                        as meaningless as the HAL side's would
                                        be), so neither row shows one. */}
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
