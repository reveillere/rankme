import { useEffect, useRef, useState } from 'react';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { searchCandidates } from '../rankCandidates';
import { setOverride, clearOverride, confirmMatch, patchOverrideCandidate } from '../matchOverrides';

const DEBOUNCE_MS = 300;

export const MATCH_STYLE = {
  exact: { label: 'Exact match', color: '#2e7d32' },
  fuzzy: { label: 'Approximate match', color: '#e07b00' },
  ambiguous: { label: 'Ambiguous match', color: '#c62828' },
  manual: { label: 'Manually set by you', color: '#1565c0' },
  confirmed: { label: 'Confirmed by you', color: '#66bb6a' },
  // A different blue than "manual" -- both are corrections rather than an
  // automatic match, but this one nobody in this browser actually made;
  // it's a different-enough shade to tell apart at a glance while still
  // reading as "someone deliberately set this", not a computed result.
  shared: { label: 'Confirmed by the community', color: '#0288d1' },
  none: { label: 'No match found', color: '#757575' },
};

// CORE grades and SJR quartiles on one shared best-to-worst scale, so a
// historical-vs-current rank pair can be compared regardless of portal.
// "Misc"/"Unranked" aren't included: they're not this kind of grade at all,
// so there's nothing meaningful to say about their trend.
const RANK_ORDER = { 'A*': 4, 'A': 3, 'B': 2, 'C': 1, 'Q1': 4, 'Q2': 3, 'Q3': 2, 'Q4': 1 };

function trendOf(fromValue, toValue) {
  const a = RANK_ORDER[fromValue];
  const b = RANK_ORDER[toValue];
  if (a == null || b == null || a === b) return null;
  return b > a ? 'up' : 'down';
}

// One clickable candidate row -- the rank first, in a fixed-width column so
// a whole list of them lines up and stays scannable, then the title on the
// same line rather than wrapping to a second line just for its grade.
// Shared by the "equally close" list (an ambiguous match's tied entries)
// and the "change match" search results below, so picking a candidate
// works the same way -- click it -- in both places instead of only the
// search results being clickable.
//
// rawValue (CORE's own category behind a "Misc" bucket, see bucketRank in
// corePortal.js) is appended after the title/acronym rather than into the
// rank column itself -- that column has to stay a short, fixed width for
// every row to line up, so any extra detail flows with the (already
// variable-width) title text instead of stretching the column per-row.
function CandidateListItem({ value, rawValue, title, acronym, onClick }) {
  return (
    <ListItemButton onClick={onClick} sx={{ py: 0.5, alignItems: 'flex-start' }}>
      <Typography
        component="span"
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 40, flexShrink: 0, fontWeight: 700 }}
      >
        {value}
      </Typography>
      <Typography component="span" variant="body2" sx={{ wordBreak: 'break-word' }}>
        {title}{acronym ? ` (${acronym})` : ''}
        {rawValue && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            — {rawValue}
          </Typography>
        )}
      </Typography>
    </ListItemButton>
  );
}

// A two-column row -- label of fixed width, then wrapping text -- so
// "Original text" and "Matched" line up on the same starting column instead
// of each just running on right after its own (differently-sized) label.
function LabeledRow({ label, children }) {
  return (
    <Box sx={{ display: 'flex', mb: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 132, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{children}</Typography>
    </Box>
  );
}

// The full picture behind one CORE/SJR badge: what year and edition it was
// computed against, which entry it matched (or why it couldn't), how
// confident that match is, how the same entry ranks today, and a search box
// to replace it with a different entry -- a correction that's saved to this
// browser immediately and also mirrored to the server for later analysis.
export function RankDetailsPopover({ anchorEl, onClose, portal, year, rank, override, sharedOverride, resolvedFullName, onOverrideChange }) {
  const open = Boolean(anchorEl);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef();

  // No effect resetting query/results on close: RankBadge now only renders
  // this component at all while anchorEl is set (see RankBadge.js), so
  // closing unmounts it and discards this state naturally -- a fresh mount
  // next open always starts blank.

  // Overrides/confirmations saved before candidate search results carried
  // currentSource/currentValue (or imported from an older CSV export) are
  // missing that "rank in the latest edition" info -- backfill it live the
  // first time the popover opens on one, and persist it so it's not
  // re-fetched on every open.
  useEffect(() => {
    if (!open || !override || override.candidate.currentValue || !year) return;
    let cancelled = false;
    searchCandidates(portal, year, override.candidate.title).then(found => {
      if (cancelled) return;
      const match = found.find(c => c.id === override.candidate.id);
      if (match?.currentValue) {
        const patched = patchOverrideCandidate(override.key, { currentSource: match.currentSource, currentValue: match.currentValue, currentRawValue: match.currentRawValue ?? null });
        if (patched) onOverrideChange();
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, override?.key]);

  const handleQueryChange = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchCandidates(portal, year, value);
      setResults(found);
      setSearching(false);
    }, DEBOUNCE_MS);
  };

  // Each of these persists via matchOverrides.js's write(), which dispatches
  // 'rankme:overridechange' globally (picked up by the container's
  // useOverrideRefreshTick(), for the review-count/filter recompute) -- but
  // that alone doesn't touch *this* row's own rendered output, since the
  // underlying publication object itself never changes, only what
  // localStorage says about it. onOverrideChange (threaded down from
  // PublicationRow/HalPublicationRow via RankBadge.js) forces just this one
  // row to re-render with the fresh override, without touching any other
  // row -- see PublicationRow's own comment for why a global signal isn't
  // used here.
  const pickCandidate = (candidate) => {
    setOverride({ portal, rank, year, candidate });
    onOverrideChange();
    onClose();
  };

  const confirmThisMatch = () => {
    confirmMatch({ portal, rank, year });
    onOverrideChange();
  };

  const resetToAutomatic = () => {
    clearOverride(override.key);
    onOverrideChange();
    onClose();
  };

  // For when the automatic (or even a previously picked) match is simply
  // wrong and nothing in "Change match" below is the right entry either --
  // e.g. a workshop whose title happens to fuzzy-match an unrelated
  // conference. Confirm only ever agrees with the existing guess, and
  // picking a candidate only ever replaces it with a different *specific*
  // entry; neither lets a reviewer say "this venue just isn't ranked at
  // all," which a personal override recording the same synthetic
  // "Unranked" shape corePortal.js/sjrPortal.js already use for a genuine
  // no-match can represent perfectly well.
  const markAsUnranked = () => pickCandidate({ id: null, title: null, value: 'Unranked' });

  if (!rank) return null;

  const isConfirmed = override?.type === 'confirmed';
  const isManualOverride = override && !isConfirmed;
  // A personal override/confirmation always wins over a shared one -- the
  // shared correction only applies when this browser hasn't set its own.
  const isShared = !override && !!sharedOverride;
  const effectiveMatchType = isConfirmed ? 'confirmed' : isManualOverride ? 'manual' : isShared ? 'shared' : rank.matchType;
  const style = MATCH_STYLE[effectiveMatchType] || MATCH_STYLE.none;
  const isJournal = portal === 'sjr';
  const isCcf = portal === 'ccf';
  const displayedValue = isManualOverride ? override.candidate.value : isShared ? sharedOverride.candidate.value : rank.value;
  // CORE's own category behind a "Misc" bucket (e.g. "Multiconference") --
  // see bucketRank in corePortal.js. Shown alongside the bucket everywhere
  // the value itself is shown, so "Misc" never hides what CORE actually
  // says.
  const displayedRawValue = isManualOverride ? override.candidate.rawValue : isShared ? sharedOverride.candidate.rawValue : rank.rawValue;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box sx={{ width: 580, maxWidth: '90vw', p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {isCcf ? 'CCF' : isJournal ? 'SJR' : 'CORE'} ranking{year ? ` — ${year}` : ''}
          </Typography>
          <Typography variant="body2" sx={{ color: style.color, fontWeight: 600 }}>
            {style.label}
          </Typography>
        </Box>

        <Typography variant="body2" sx={{ mb: 0.5 }}>
          Rank: <strong>{displayedValue}</strong>
          {displayedRawValue && <Typography component="span" variant="body2" color="text.secondary"> ({displayedRawValue})</Typography>}
          <Typography component="span" variant="body2" color="text.secondary"> (edition {rank.source})</Typography>
        </Typography>

        {rank.queryText && <LabeledRow label="Original text:">&quot;{rank.queryText}&quot;</LabeledRow>}
        {/* Crossref's own venue name for this record's DOI, when
            authorStream.js's DOI fallback found one -- shown even when it
            *didn't* change the match above (only adopted there when
            clearly better, see that fallback's own comment): the resolved
            name was still looked up and is worth surfacing, especially
            since it's what Publications.js's own venue line now shows
            instead of dblp's abbreviated text. */}
        {resolvedFullName && resolvedFullName !== rank.queryText && (
          <LabeledRow label="Resolved via DOI:">&quot;{resolvedFullName}&quot;</LabeledRow>
        )}

        {isManualOverride ? (
          <Box sx={{ my: 1 }}>
            <LabeledRow label="You set this to:">
              {/* markAsUnranked's candidate has no title/id at all -- it isn't
                  a specific entry, just "this venue isn't ranked" -- so fall
                  back to its value (always 'Unranked') instead of rendering
                  an empty <strong> for a title that was never set. */}
              <strong>{override.candidate.title || override.candidate.value}</strong>{override.candidate.acronym ? ` (${override.candidate.acronym})` : ''}
            </LabeledRow>
            <Typography variant="caption" color="text.secondary">
              Automatic match was: {rank.matchedTitle ? `"${rank.matchedTitle}" — ${rank.value}${rank.rawValue ? ` (${rank.rawValue})` : ''}` : `no match (${rank.value})`}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Button size="small" onClick={resetToAutomatic}>Reset to automatic match</Button>
            </Box>
          </Box>
        ) : isConfirmed ? (
          <Box sx={{ my: 1 }}>
            <LabeledRow label="Matched:">
              <strong>{rank.matchedTitle}</strong>{rank.matchedAcronym ? ` (${rank.matchedAcronym})` : ''}
            </LabeledRow>
            <Typography variant="caption" color="text.secondary">
              You confirmed this match is correct.
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Button size="small" onClick={resetToAutomatic}>Remove confirmation</Button>
            </Box>
          </Box>
        ) : isShared ? (
          <Box sx={{ my: 1 }}>
            <LabeledRow label="Community match:">
              <strong>{sharedOverride.candidate.title}</strong>{sharedOverride.candidate.acronym ? ` (${sharedOverride.candidate.acronym})` : ''}
            </LabeledRow>
            <Typography variant="caption" color="text.secondary">
              Confirmed by {sharedOverride.confirmedCount} other {sharedOverride.confirmedCount === 1 ? 'person' : 'people'} who corrected this same text.
              Automatic match was: {rank.matchedTitle ? `"${rank.matchedTitle}" — ${rank.value}${rank.rawValue ? ` (${rank.rawValue})` : ''}` : `no match (${rank.value})`}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Search below to set your own correction instead, or turn community corrections off in Settings.
            </Typography>
          </Box>
        ) : rank.matchType === 'ambiguous' ? (
          <Box sx={{ my: 1 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Equally close to several entries that don&apos;t agree on a rank — pick one:</Typography>
            <List dense disablePadding>
              {(rank.ambiguousWith || []).map((c, i) => (
                <CandidateListItem key={i} value={c.value} rawValue={c.rawValue} title={c.title} acronym={c.acronym} onClick={() => pickCandidate(c)} />
              ))}
            </List>
            <Box sx={{ mt: 1 }}>
              <Button size="small" color="error" variant="outlined" onClick={markAsUnranked}>
                None of these — remove this match
              </Button>
            </Box>
          </Box>
        ) : rank.matchedTitle ? (
          <Box sx={{ my: 1 }}>
            <LabeledRow label="Matched:">
              <strong>{rank.matchedTitle}</strong>{rank.matchedAcronym ? ` (${rank.matchedAcronym})` : ''}
            </LabeledRow>
            {rank.distance != null && (
              <Typography variant="caption" color="text.secondary">
                Title word distance: {rank.distance}
              </Typography>
            )}
            <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
              {rank.matchType === 'fuzzy' && (
                <Button size="small" color="success" variant="outlined" onClick={confirmThisMatch}>
                  Confirm this match is correct
                </Button>
              )}
              {/* Shown for 'exact' too, not just 'fuzzy': an acronym or dblp
                  key can still land on the wrong entry outright -- e.g.
                  ccfPortal.js's own buildIndex comment notes AsiaCCS's row
                  pointing at the same dblp key as CCS itself -- so "this
                  specific match is wrong" needs an escape hatch even when
                  the system considers it certain. */}
              <Button size="small" color="error" variant="outlined" onClick={markAsUnranked}>
                Remove this match
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ my: 1 }}>No matching entry found in this edition.</Typography>
        )}

        {(() => {
          const current = isManualOverride ? override.candidate : isShared ? sharedOverride.candidate : rank;
          if (!current.currentValue) return null;
          const trend = trendOf(displayedValue, current.currentValue);
          return (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Rank in the latest edition ({current.currentSource}): <strong>{current.currentValue}</strong>
              {current.currentRawValue && <Typography component="span" variant="body2" color="text.secondary"> ({current.currentRawValue})</Typography>}
              {trend === 'up' && <ArrowUpwardIcon fontSize="inherit" sx={{ color: '#2e7d32', verticalAlign: 'middle', ml: 0.3 }} />}
              {trend === 'down' && <ArrowDownwardIcon fontSize="inherit" sx={{ color: '#c62828', verticalAlign: 'middle', ml: 0.3 }} />}
              {current.currentValue === displayedValue && (
                // MUI's CompareArrowsIcon is actually two separate opposing
                // arrows stacked on top of each other, not one line with a
                // head on each end -- the literal ↔ character is simpler
                // and unambiguous here.
                <Typography component="span" sx={{ color: '#1976d2', verticalAlign: 'middle', ml: 0.5, fontWeight: 700 }}>
                  ↔
                </Typography>
              )}
            </Typography>
          );
        })()}

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Change match</Typography>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder={isCcf ? 'Search conference or journal name…' : isJournal ? 'Search journal name…' : 'Search conference name or acronym…'}
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
        />
        {searching && (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}><CircularProgress size={20} /></Box>
        )}
        {!searching && query.trim().length >= 2 && (
          <List dense sx={{ maxHeight: 220, overflowY: 'auto', mt: 0.5 }}>
            {results.length === 0
              ? <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>No match</Typography>
              : results.map(c => (
                <CandidateListItem key={c.id} value={c.value} rawValue={c.rawValue} title={c.title} acronym={c.acronym} onClick={() => pickCandidate(c)} />
              ))}
          </List>
        )}
      </Box>
    </Popover>
  );
}
