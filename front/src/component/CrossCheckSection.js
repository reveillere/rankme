import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';

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

// Width reserved for the confirm/reject IconButton pair on a HAL candidate
// row -- the DBLP row above it reserves the same empty width (see the
// spacer Box there) purely so both rows' chip+publication content start at
// the same x position, letting the .box/.nr/.rank/cite columns of
// PublicationRow/HalPublicationRow line up visually between the two.
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

// boxSx/headingVariant: CrossCheck.js renders this straight at page level (a
// wider block, own top-level heading), while CrossCheckStructure.js/
// CrossCheckTeam.js nest it inside their own per-member section (which
// already provides that outer width/margin and its own "Publications for
// X" heading above it) -- everything else about the section is identical
// between all three, only how it's introduced differs.
export function CrossCheckSection({ title, description, rows, showCandidates, pids, onOpenAuthor, onSearchAuthor, onDecide, sharedMaps, activeCustomProfileIds, boxSx = { mb: 2 }, headingVariant = 'subtitle2' }) {
    return (
        <Box sx={boxSx}>
            <Typography variant={headingVariant} sx={{ mb: description ? 0.5 : 1 }}>{title} ({rows.length})</Typography>
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
                // left of the HAL row they apply to. A Divider separates one
                // DBLP pub (+ its candidates) from the next.
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
