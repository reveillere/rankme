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

import { Selector, CategoriesSelector } from './Selector';
import { categories, useFilterSettings } from '../FilterSettingsContext';
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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Display settings</DialogTitle>
      <DialogContent>
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
