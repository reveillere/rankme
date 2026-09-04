import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { dblpCategories } from '../dblp';
import { halCategories } from '../hal';
import { RankSelector, CategoriesSelector } from './Selector';
import { useFilterSettings } from '../FilterSettingsContext';

export function SettingsDialog({ open, onClose }) {
  const {
    filterRanks, setFilterRanks,
    filterCategoriesDblp, setFilterCategoriesDblp,
    filterCategoriesHal, setFilterCategoriesHal,
  } = useFilterSettings();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Display settings</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" gutterBottom>Ranks</Typography>
        <RankSelector selected={filterRanks} setSelected={setFilterRanks} />

        <Divider style={{ margin: '24px 0' }} />

        <Typography variant="subtitle1" gutterBottom>DBLP categories</Typography>
        <CategoriesSelector selected={filterCategoriesDblp} setSelected={setFilterCategoriesDblp} categories={dblpCategories} />

        <Divider style={{ margin: '24px 0' }} />

        <Typography variant="subtitle1" gutterBottom>HAL categories</Typography>
        <CategoriesSelector selected={filterCategoriesHal} setSelected={setFilterCategoriesHal} categories={halCategories} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
