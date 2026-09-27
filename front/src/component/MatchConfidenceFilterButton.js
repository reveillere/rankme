import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TrafficIcon from '@mui/icons-material/Traffic';

import { Selector } from './Selector';
import { matchTypes, useFilterSettings } from '../FilterSettingsContext';

// Replaces the old single "Only show matches to review" checkbox (fuzzy or
// ambiguous, no override) with the full set of match-confidence outcomes a
// rank badge's dot can show (see matchOverrides.js's effectiveMatchType) --
// so e.g. isolating "confirmed by the community" or "custom ranking" matches
// is possible too, not just the one fixed combination the toggle covered.
// Same icon-button-opens-a-popover pattern as CategoriesFilterButton.js,
// placed right next to it in the toolbar (year filter, categories, sort).
//
// records/filterKey (optional): the page's own unfiltered publications plus
// its matchTypeAccessor -- unlike CategoriesFilterButton (rendered once,
// globally, in App.js, with no single page's data to count against), this
// button is instantiated per-page (Author.js/AuthorHal.js/Team.js/
// Structure.js), so it can show each option's real count, e.g. "Approximate
// match (12)" -- see Selector.js's own showCounts behavior. Deliberately the
// page's full rankedPublications, not the already-filtered list: counting
// against a list this same filter has already shrunk would make an unchecked
// box's own count collapse to 0 instead of showing what it would restore.
export function MatchConfidenceFilterButton({ records, filterKey }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const { filterMatchTypes, setFilterMatchTypes } = useFilterSettings();

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="match confidence">
        <TrafficIcon />
      </IconButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 280, maxWidth: '90vw', p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Match confidence</Typography>
          <Selector selected={filterMatchTypes} setSelected={setFilterMatchTypes} data={matchTypes} records={records} filterKey={filterKey} />
        </Box>
      </Popover>
    </>
  );
}
