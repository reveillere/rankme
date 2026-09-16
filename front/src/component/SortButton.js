import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import SortIcon from '@mui/icons-material/Sort';
import { SORT_MODES } from '../rankOrder';

const LABELS = {
  date: 'Date',
  'date-rank': 'Date, then rank',
  'rank-date': 'Rank, then date',
};

// One shared button/menu for all 4 publication-list pages (Author.js/
// AuthorHal.js/Team.js/Structure.js) -- sits next to FilterButton in each,
// see e.g. Author.js's own button row. A single component here rather than
// 4 copies since the behavior (and the 3 options) is identical everywhere;
// only the sortMode/setSortMode state itself lives per-page (see each
// page's own sortMode state, threaded down to its Publications/
// HalPublications).
export function SortButton({ sortMode, setSortMode }) {
  const [anchorEl, setAnchorEl] = useState(null);

  return (
    <>
      <Tooltip title={`Sort: ${LABELS[sortMode] || LABELS.date}`}>
        <IconButton
          color="primary"
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="sort order"
          sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}
        >
          <SortIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {SORT_MODES.map(mode => (
          <MenuItem
            key={mode}
            selected={mode === sortMode}
            onClick={() => { setSortMode(mode); setAnchorEl(null); }}
          >
            {LABELS[mode]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
