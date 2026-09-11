import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';
import FilterAltIcon from '@mui/icons-material/FilterAlt';

import { Selector, CategoriesSelector } from './Selector';
import { categories, useFilterSettings } from '../FilterSettingsContext';
import CorePortal from '../corePortal';
import SjrPortal from '../sjrPortal';
import CcfPortal from '../ccfPortal';

// article/inproceedings are the only two categories a rank actually applies
// to — nesting their ranks right under them makes that relationship visible
// instead of relying on a tooltip to explain a disabled checkbox elsewhere.
const PLAIN_CATEGORIES = Object.fromEntries(
  Object.entries(categories).filter(([key]) => key !== 'article' && key !== 'inproceedings')
);

// A category and the ranks that only apply to it — each side disables
// itself while the other is entirely empty, since e.g. a conference rank
// with no conference category selected can never match anything.
function CategoryWithRanks({ categoryKey, rankData, filterCategories, setFilterCategories, filterRanks, setFilterRanks }) {
  const categoryChecked = !!filterCategories[categoryKey];
  const hasAnyRank = Object.keys(rankData).some(key => filterRanks[key]);
  const categoryDisabled = !hasAnyRank;
  const ranksDisabled = !categoryChecked;
  const categoryLabel = categories[categoryKey].name;

  const toggleCategory = () => setFilterCategories({ ...filterCategories, [categoryKey]: !categoryChecked });

  const checkbox = (
    <FormControlLabel
      disabled={categoryDisabled}
      control={<Checkbox checked={categoryChecked} onChange={toggleCategory} size="small" />}
      label={<Typography sx={{ fontWeight: 600 }}>{categoryLabel}</Typography>}
    />
  );

  return (
    <Box sx={{ mb: 2.5 }}>
      {categoryDisabled ? (
        <Tooltip title="Select at least one matching rank to use this category" placement="right">
          <span>{checkbox}</span>
        </Tooltip>
      ) : checkbox}

      <Box sx={{ pl: 4, opacity: ranksDisabled ? 0.5 : 1 }}>
        <Selector
          selected={filterRanks}
          setSelected={setFilterRanks}
          data={rankData}
          disabledKeys={ranksDisabled ? Object.keys(rankData) : []}
          disabledReason={`Select "${categoryLabel}" above to use these ranks`}
        />
      </Box>
    </Box>
  );
}

// Moved out of SettingsDialog.js into its own toolbar icon: this is a
// per-visit "what to show in the list right now" filter, not an app-wide
// preference the way ranking source/community corrections are -- a
// dedicated icon (next to "my match corrections"/"settings" in App.js)
// makes it reachable in one click instead of buried a scroll down in
// Settings.
export function CategoriesFilterButton() {
  const [anchorEl, setAnchorEl] = useState(null);
  const { filterRanks, setFilterRanks, filterCategories, setFilterCategories, rankingSource } = useFilterSettings();
  const categoryRankData = rankingSource === 'ccf' ? CcfPortal.ranks : null;

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="publication categories">
        <FilterAltIcon />
      </IconButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 420, maxWidth: '90vw', p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Publication categories</Typography>

          <CategoryWithRanks
            categoryKey="inproceedings"
            rankData={categoryRankData || CorePortal.ranks}
            filterCategories={filterCategories}
            setFilterCategories={setFilterCategories}
            filterRanks={filterRanks}
            setFilterRanks={setFilterRanks}
          />
          <CategoryWithRanks
            categoryKey="article"
            rankData={categoryRankData || SjrPortal.ranks}
            filterCategories={filterCategories}
            setFilterCategories={setFilterCategories}
            filterRanks={filterRanks}
            setFilterRanks={setFilterRanks}
          />

          <CategoriesSelector selected={filterCategories} setSelected={setFilterCategories} categories={PLAIN_CATEGORIES} />
        </Box>
      </Popover>
    </>
  );
}
