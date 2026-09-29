import { useState } from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import UndoIcon from '@mui/icons-material/Undo';

import { dblpCategories } from '../dblp';
import { getHalCategory } from '../hal';
import { PublicationRow } from './Publications';
import { HalPublicationRow } from './HalPublications';

// Shared by CrossCheck.js/CrossCheckStructure.js/CrossCheckTeam.js: the
// Missing/To-review section rendering (and the row-numbering/CSV-escaping
// it's always paired with) used to be copy-pasted three times, byte-for-byte
// identical apart from what wraps around it (a whole-page report vs one
// section per structure/team member) -- see git history if you need the
// pre-factoring per-file comments explaining the DBLP-row-greyed-out-above/
// HAL-candidates-below layout, the confirm/reject icon pair, and the
// ACTION_WIDTH/CHIP_WIDTH spacer widths.

// HalPublicationRow needs a selfIds array to know which author to render as
// "self" rather than a clickable link -- there is no such notion here (a
// crosscheck candidate's authors are all just "someone on this paper", not
// necessarily this page's own dblp author under a HAL identity), so this is
// always empty. A shared, module-level constant (not `[]` inline at the call
// site) so it stays referentially stable across renders -- see
// HalPublicationRow's own React.memo comment (HalPublications.js) for why
// that matters, same reasoning as Structure.js/Team.js's own selfIds.
export const NO_SELF_IDS = [];

// Width reserved for the confirm/reject (or, in the "Confirmed" section,
// undo) IconButton(s) on a HAL candidate row -- the DBLP row above it
// reserves the same empty width (see the spacer Box there) purely so both
// rows' chip+publication content start at the same x position, letting the
// .box/.nr/.rank/cite columns of PublicationRow/HalPublicationRow line up
// visually between the two.
export const ACTION_WIDTH = 76;

// Fixed width for the DBLP/HAL chips below -- MUI's Chip otherwise sizes
// itself to its label, and "DBLP 2015" vs "HAL 2013" are rarely the exact
// same number of characters, which would shift everything after the chip
// (and so the .box/.nr/.rank/cite columns) out of alignment between the two
// rows purely based on how many digits/letters that particular year/label
// happens to have.
export const CHIP_WIDTH = 92;

// nr (e.g. "[j5]") numbers each publication within its own category, most
// recent first, same convention as Publications.js's own row numbering.
// Relies on `results` already arriving sorted most-recent-first
// (matchPublications preserves getDblpPublicationsForCrosscheck's own
// year-desc order from dblpLocal.js).
export function withRowNumbers(results) {
    const typeCounts = results.reduce((acc, r) => {
        acc[r.publication.type] = (acc[r.publication.type] || 0) + 1;
        return acc;
    }, {});
    return results.map(result => ({
        result,
        nr: dblpCategories[result.publication.type].letter + typeCounts[result.publication.type]--,
    }));
}

export function csvEscape(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One DBLP publication (greyed out, no actions of its own) stacked above
// every HAL candidate it might be the same paper as -- shared by the
// "to review" (confirm/reject) and "confirmed" (undo) layouts below, which
// differ only in what `renderActions` puts in the ACTION_WIDTH column next
// to each HAL row. Factored out so those two call sites don't copy-paste
// the whole DBLP-row/HAL-row/chip/alignment block, only the actions.
function DblpWithMatches({ result, isLast, pids, onOpenAuthor, onSearchAuthor, sharedMaps, activeCustomProfileIds, renderActions }) {
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, opacity: 0.55 }}>
                {/* Empty spacer the same width as the actions column below, so
                    the DBLP row's chip (and, past it, PublicationRow's own
                    .box/.rank/cite columns) line up with every HAL candidate
                    row underneath instead of starting further left than they
                    do. */}
                <Box sx={{ width: ACTION_WIDTH, flexShrink: 0 }} />
                <Chip label={`DBLP ${result.publication.dblp.year}`} size="small" sx={{ mt: '4px', flexShrink: 0, width: CHIP_WIDTH }} />
                <ul className="publ-list" style={{ flex: 1, margin: 0 }}>
                    <li className={`entry ${result.publication.type}`}>
                        {/* No nr here -- see PublicationRow's own comment: it
                            would sit right next to a HAL candidate row that
                            never gets one either (a number computed over just
                            the handful of publications in this section would
                            be as meaningless as the HAL side's would be), so
                            neither row shows one. */}
                        <PublicationRow item={result.publication} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
                    </li>
                </ul>
            </Box>
            {result.matches.map(m => {
                const category = getHalCategory(m.halPub.type);
                return (
                    <Box key={m.halPub.docid} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1 }}>
                        <Box sx={{ width: ACTION_WIDTH, flexShrink: 0, display: 'flex', mt: '2px' }}>
                            {renderActions(m)}
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
            {!isLast && <Divider sx={{ my: 2 }} />}
        </Box>
    );
}

// boxSx/headingVariant: CrossCheck.js renders this straight at page level (a
// wider block, own top-level heading), while CrossCheckStructure.js/
// CrossCheckTeam.js nest it inside their own per-member section (which
// already provides that outer width/margin and its own "Publications for
// X" heading above it) -- everything else about the section is identical
// between all three, only how it's introduced differs.
//
// showCandidates ("To review") and confirmed ("Confirmed by you"/"Confirmed
// automatically") are mutually exclusive DBLP-row/HAL-row layouts (see
// DblpWithMatches above); a plain flat list is used for everything else
// (Missing from HAL/Not claimed on HAL).
//
// Every section is collapsible (its own chevron+title+count, same look
// regardless of kind -- "Confirmed automatically" used to be a bespoke
// wrapper hand-rolled once per page around a hideHeading'd instance of this
// component; folded in here instead so every section is visually "at the
// same level"). defaultOpen=false is passed for the two Confirmed variants
// only; every other kind starts open. unmountOnExit on the Collapse below
// matters most for those two -- there can be hundreds of automatically-
// confirmed rows for a prolific author, not worth paying to render while
// collapsed.
//
// A section with zero rows still renders its own "Title (0)" header
// (greyed out, not clickable -- nothing to expand into) rather than
// disappearing entirely: a maintainer scanning the page can then see at a
// glance which categories genuinely have nothing (still listed, just
// dimmed) vs. which ones were never computed for this report at all.
export function CrossCheckSection({ title, description, rows, showCandidates, confirmed, unclaimed, pids, onOpenAuthor, onSearchAuthor, onDecide, onUndo, sharedMaps, activeCustomProfileIds, boxSx = { mb: 2 }, headingVariant = 'subtitle2', defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    const empty = rows.length === 0;
    return (
        <Box sx={boxSx}>
            <Typography
                variant={headingVariant}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.5 : 1, mb: !empty && description ? 0.5 : (!empty && open ? 1 : 0) }}
                onClick={empty ? undefined : () => setOpen(o => !o)}
            >
                <IconButton size="small" sx={{ p: 0 }} disabled={empty} tabIndex={-1}>
                    {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
                {title} ({rows.length})
            </Typography>
            {empty ? null : <>
            {description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{description}</Typography>
            )}
            <Collapse in={open} unmountOnExit>
            {showCandidates ? (
                rows.map(({ result }, i) => (
                    <DblpWithMatches
                        key={result.publication.dblp.key}
                        result={result}
                        isLast={i === rows.length - 1}
                        pids={pids}
                        onOpenAuthor={onOpenAuthor}
                        onSearchAuthor={onSearchAuthor}
                        sharedMaps={sharedMaps}
                        activeCustomProfileIds={activeCustomProfileIds}
                        renderActions={m => <>
                            <Tooltip title="Confirm same paper">
                                <IconButton size="small" onClick={() => onDecide(result.publication.dblp.key, m.halPub.docid, 'same')}>
                                    <CheckCircleOutlineIcon fontSize="small" color="success" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Not the same paper">
                                <IconButton size="small" onClick={() => onDecide(result.publication.dblp.key, m.halPub.docid, 'different')}>
                                    <HighlightOffIcon fontSize="small" color="error" />
                                </IconButton>
                            </Tooltip>
                        </>}
                    />
                ))
            ) : confirmed ? (
                rows.map(({ result }, i) => (
                    <DblpWithMatches
                        key={result.publication.dblp.key}
                        result={result}
                        isLast={i === rows.length - 1}
                        pids={pids}
                        onOpenAuthor={onOpenAuthor}
                        onSearchAuthor={onSearchAuthor}
                        sharedMaps={sharedMaps}
                        activeCustomProfileIds={activeCustomProfileIds}
                        // onUndo is absent for an automatic confirmation (no
                        // local decision behind it -- see CrossCheck.js's own
                        // "Confirmed automatically" section -- there's
                        // nothing to undo), unlike a decided one.
                        renderActions={onUndo ? m => (
                            <Tooltip title="Undo, back to review">
                                <IconButton size="small" onClick={() => onUndo(result.publication.dblp.key, m.halPub.docid)}>
                                    <UndoIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        ) : () => null}
                    />
                ))
            ) : unclaimed ? (
                <ul className="publ-list">
                    {rows.map(({ result, nr }) => (
                        <li className={`entry ${result.publication.type}`} key={result.publication.dblp.key}>
                            <PublicationRow item={result.publication} nr={nr} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: -0.5, mb: 1.5 }}>
                                Already on HAL as{' '}
                                <a href={result.unclaimedMatch.url} target="_blank" rel="noreferrer">{result.unclaimedMatch.halId || result.unclaimedMatch.docid}</a>
                                , but not linked to your HAL identity — ask a co-author to add it, or link it yourself from your own HAL account.
                            </Typography>
                        </li>
                    ))}
                </ul>
            ) : (
                <ul className="publ-list">
                    {rows.map(({ result, nr }) => (
                        <li className={`entry ${result.publication.type}`} key={result.publication.dblp.key}>
                            <PublicationRow item={result.publication} nr={nr} pids={pids} onOpenAuthor={onOpenAuthor} sharedMaps={sharedMaps} activeCustomProfileIds={activeCustomProfileIds} />
                        </li>
                    ))}
                </ul>
            )}
            </Collapse>
            </>}
        </Box>
    );
}
