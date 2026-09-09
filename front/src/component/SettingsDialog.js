import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';

import { Selector, CategoriesSelector } from './Selector';
import { categories, useFilterSettings } from '../FilterSettingsContext';
import { getUseCommunityOverrides, setUseCommunityOverrides } from '../matchOverrides';
import CorePortal from '../corePortal';
import SjrPortal from '../sjrPortal';

// article/inproceedings are the only two categories a rank actually applies
// to — nesting their ranks right under them makes that relationship visible
// instead of relying on a tooltip to explain a disabled checkbox elsewhere.
const PLAIN_CATEGORIES = Object.fromEntries(
  Object.entries(categories).filter(([key]) => key !== 'article' && key !== 'inproceedings')
);

export function SettingsDialog({ open, onClose }) {
  const {
    filterRanks, setFilterRanks,
    filterCategories, setFilterCategories,
  } = useFilterSettings();
  // Not part of FilterSettingsContext: that context is for chart/list
  // filtering (re-applied reactively as you change it), while this is a
  // one-off "trust the crowd or not" preference, read fresh by each
  // RankBadge only when it starts loading its shared-overrides fetch (see
  // RankBadge.js) -- plain localStorage is enough, matching e.g. About.js's
  // "don't show this again" checkbox.
  const [useCommunityOverrides, setUseCommunityOverridesState] = useState(getUseCommunityOverrides);
  const handleCommunityOverridesChange = (e) => {
    setUseCommunityOverridesState(e.target.checked);
    setUseCommunityOverrides(e.target.checked);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Display settings</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" gutterBottom>Match corrections</Typography>
        <FormControlLabel
          control={<Checkbox checked={useCommunityOverrides} onChange={handleCommunityOverridesChange} size="small" />}
          label={<Typography variant="body2">Use community-confirmed corrections</Typography>}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 2 }}>
          When a CORE/SJR match gets corrected the same way by several different people, everyone sees that correction
          by default. Your own corrections (see &quot;My match corrections&quot;) always take priority over this.
        </Typography>
        <Divider sx={{ mb: 2.5 }} />

        <Typography variant="subtitle1" gutterBottom>Publication categories</Typography>

        <CategoryWithRanks
          categoryKey="inproceedings"
          rankData={CorePortal.ranks}
          filterCategories={filterCategories}
          setFilterCategories={setFilterCategories}
          filterRanks={filterRanks}
          setFilterRanks={setFilterRanks}
        />
        <CategoryWithRanks
          categoryKey="article"
          rankData={SjrPortal.ranks}
          filterCategories={filterCategories}
          setFilterCategories={setFilterCategories}
          filterRanks={filterRanks}
          setFilterRanks={setFilterRanks}
        />

        <CategoriesSelector selected={filterCategories} setSelected={setFilterCategories} categories={PLAIN_CATEGORIES} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

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
