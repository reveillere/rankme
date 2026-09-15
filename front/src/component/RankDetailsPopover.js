import { useEffect, useRef, useState } from 'react';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { searchCandidates } from '../rankCandidates';
import { setOverride, clearOverride, confirmMatch, patchOverrideCandidate } from '../matchOverrides';
import { ranksForReference, getProfile, getEffectiveCustomValue, setEntry, deleteEntry, entryKeyFor } from '../customRankings';

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
  // Distinct from every correction color above (a custom ranking replaces
  // the automatic match/correction machinery for this axis entirely, see
  // customRankings.js's own decision 2 comment, rather than being one more
  // kind of correction on top of it).
  custom: { label: 'Custom ranking', color: '#6a1b9a' },
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
export function RankDetailsPopover({ anchorEl, onClose, portal, year, rank, override, sharedOverride, resolvedFullName, activeCustomProfileId, onOverrideChange }) {
  const open = Boolean(anchorEl);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef();
  // "Apply to all editions" / "also apply to these years" -- see decision 4
  // in the implementation plan. Not reset via an effect for the same reason
  // query/results below aren't: this component only exists while the
  // popover is open (RankBadge unmounts it on close), so a fresh mount
  // always starts from these defaults.
  const [applyToAllEditions, setApplyToAllEditions] = useState(false);
  const [extraYears, setExtraYears] = useState([]);
  // Only fetched when actually needed (a custom profile is active for this
  // axis) -- coreYears/sjrYears (routes.js's /api/ranking-editions) feed
  // the "also apply to these years" picker below; every other consumer of
  // this same endpoint (SettingsDialog.js) already fetches it independently
  // for its own display, so there's no shared cache to plug into here.
  const [editionYears, setEditionYears] = useState(null);
  useEffect(() => {
    if (!open || !activeCustomProfileId) return;
    let cancelled = false;
    fetch('/api/ranking-editions').then(r => r.json()).then(data => { if (!cancelled) setEditionYears(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, activeCustomProfileId]);

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

  // Sets/replaces this venue's letter in the active custom profile --
  // applyToAllEditions/extraYears above decide which edition(s) it lands on
  // (see customRankings.js's setEntry, decision 4). Doesn't close the
  // popover (unlike pickCandidate): picking a letter is something a user
  // plausibly does more than once in a row while reviewing a profile,
  // unlike replacing a match, which is a one-shot action.
  const setCustomValue = (value) => {
    setEntry({ profileId: activeCustomProfileId, portal, rank, override, year, value, applyToAllEditions, alsoApplyToYears: extraYears });
    onOverrideChange();
  };

  const clearCustomEntry = () => {
    deleteEntry(activeCustomProfileId, entryKeyFor(portal, rank, override));
    onOverrideChange();
  };

  const toggleExtraYear = (y) => setExtraYears(prev => (prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y]));

  if (!rank) return null;

  const isConfirmed = override?.type === 'confirmed';
  const isManualOverride = override && !isConfirmed;
  // A personal override/confirmation always wins over a shared one -- the
  // shared correction only applies when this browser hasn't set its own.
  const isShared = !override && !!sharedOverride;
  // A custom ranking takes over the headline value/style entirely once
  // active for this axis -- same priority customRankings.js's own
  // getDisplayValue applies, and RankBadge.js mirrors for the badge itself.
  // `rank` here is already the automatic result for the profile's own
  // reference ranking (CORE/SJR/CCF -- rankingSource.js's rankingQueryParams
  // sends confSource/journalSource=ccf whenever the reference is 'ccf', so
  // the server computes the right one), so getEffectiveCustomValue's own
  // fallback to rank.value is exactly "the reference ranking's answer" for
  // anything not explicitly overridden -- see customRankings.js's own
  // comment on this. The "Matched"/"Change match" sections further down
  // stay driven by the real automatic match regardless: they're what
  // entryKeyFor's own identity resolution (customRankings.js) keys off, so
  // correcting the underlying match still matters even while a custom
  // letter is shown on top of it.
  const customValue = activeCustomProfileId ? getEffectiveCustomValue(activeCustomProfileId, portal, rank, override, year) : null;
  const customProfile = activeCustomProfileId ? getProfile(activeCustomProfileId) : null;
  // Only the letters this profile's own reference ranking actually uses --
  // e.g. no Q1-Q4 chips for a CORE-referenced profile, nothing overriding a
  // conference/journal could ever legitimately take that value (see
  // customRankings.js's ranksForReference). Empty (no profile at all,
  // activeCustomProfileId falsy) never renders the chip row below anyway.
  const customPalette = customProfile ? ranksForReference(customProfile.reference) : {};
  const effectiveMatchType = customValue ? 'custom' : isConfirmed ? 'confirmed' : isManualOverride ? 'manual' : isShared ? 'shared' : rank.matchType;
  const style = MATCH_STYLE[effectiveMatchType] || MATCH_STYLE.none;
  const isJournal = portal === 'sjr';
  const isCcf = portal === 'ccf';
  const displayedValue = customValue ? customValue.value : isManualOverride ? override.candidate.value : isShared ? sharedOverride.candidate.value : rank.value;
  // CORE's own category behind a "Misc" bucket (e.g. "Multiconference") --
  // see bucketRank in corePortal.js. Shown alongside the bucket everywhere
  // the value itself is shown, so "Misc" never hides what CORE actually
  // says. A custom value is never a CORE rawValue -- it's a letter someone
  // picked from the reference's own palette directly (customPalette below),
  // nothing to expand on.
  const displayedRawValue = customValue ? null : isManualOverride ? override.candidate.rawValue : isShared ? sharedOverride.candidate.rawValue : rank.rawValue;
  // CORE's discrete edition list (non-contiguous, see corePortal.js's
  // getAllYears) vs SJR's contiguous span (sjrPortal.js's getYearRange,
  // expanded here into the same flat year array CORE's own list already
  // is). A CCF-*referenced* custom profile (see customRankings.js's
  // createProfile) can land here with portal 'ccf' -- CCF has no equally
  // fine-grained year list of its own (routes.js's /api/ranking-editions
  // doesn't expose one, and its own editions are sparser -- see
  // ccfPortal.js's HISTORICAL_EDITIONS), so the union of CORE's and SJR's
  // own year lists stands in as the broadest reasonable set of "other
  // years" to pick from -- not perfectly on-theme, but every one of them is
  // still a real publication year this entry's byEdition could legitimately
  // key on.
  const availableYears = portal === 'sjr'
    ? (editionYears?.sjrYears ? Array.from({ length: editionYears.sjrYears.end - editionYears.sjrYears.start + 1 }, (_, i) => editionYears.sjrYears.start + i) : [])
    : portal === 'core'
      ? (editionYears?.coreYears || [])
      : [...new Set([
          ...(editionYears?.coreYears || []),
          ...(editionYears?.sjrYears ? Array.from({ length: editionYears.sjrYears.end - editionYears.sjrYears.start + 1 }, (_, i) => editionYears.sjrYears.start + i) : []),
        ])].sort((a, b) => a - b);
  const currentYearNumber = Number(year);

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

        {activeCustomProfileId && (
          <Box sx={{ my: 1.5, p: 1.5, border: '1px solid', borderColor: MATCH_STYLE.custom.color, borderRadius: 1 }}>
            <Typography variant="subtitle2" sx={{ color: MATCH_STYLE.custom.color, fontWeight: 700, mb: 1 }}>
              Custom ranking: {customProfile?.name ?? 'Unknown profile'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
              {Object.keys(customPalette).map(value => (
                <Chip
                  key={value}
                  label={value}
                  size="small"
                  clickable
                  onClick={() => setCustomValue(value)}
                  color={customValue?.value === value ? 'secondary' : 'default'}
                  sx={customValue?.value === value ? { backgroundColor: MATCH_STYLE.custom.color, color: '#fff' } : undefined}
                />
              ))}
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={applyToAllEditions} onChange={e => setApplyToAllEditions(e.target.checked)} />}
              label={<Typography variant="body2">Apply to all editions</Typography>}
            />
            {/* Only meaningful while "all editions" isn't checked -- ALL
                already covers every year setEntry (customRankings.js) could
                otherwise be told to also cover. */}
            {!applyToAllEditions && availableYears.length > 0 && (
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Also apply to these years (in addition to {year}):
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {availableYears.filter(y => y !== currentYearNumber).map(y => (
                    <Chip
                      key={y}
                      label={y}
                      size="small"
                      clickable
                      variant={extraYears.includes(y) ? 'filled' : 'outlined'}
                      onClick={() => toggleExtraYear(y)}
                    />
                  ))}
                </Box>
              </Box>
            )}
            {customValue?.hasEntry && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" onClick={clearCustomEntry}>Clear this venue&apos;s custom entry</Button>
              </Box>
            )}
          </Box>
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
