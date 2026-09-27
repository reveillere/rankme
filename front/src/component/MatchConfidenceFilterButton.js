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
export function MatchConfidenceFilterButton() {
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
          <Selector selected={filterMatchTypes} setSelected={setFilterMatchTypes} data={matchTypes} />
        </Box>
      </Popover>
    </>
  );
}
