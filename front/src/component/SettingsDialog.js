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
import CorePortal from '../corePortal';
import SjrPortal from '../sjrPortal';

export function SettingsDialog({ open, onClose }) {
  const {
    filterRanks, setFilterRanks,
    filterCategoriesDblp, setFilterCategoriesDblp,
    filterCategoriesHal, setFilterCategoriesHal,
  } = useFilterSettings();

  // Ranks and the categories they apply to are two sides of the same
  // filter — a conference rank with no conference category selected (or
  // vice versa) can never match anything, so each side is disabled while
  // its counterpart is entirely empty.
  const hasAnyCoreRank = Object.keys(CorePortal.ranks).some(key => filterRanks[key]);
  const hasAnyJournalRank = Object.keys(SjrPortal.ranks).some(key => filterRanks[key]);
  const hasAnyConfCategory = !!filterCategoriesDblp.inproceedings || !!filterCategoriesHal.COMM;
  const hasAnyJournalCategory = !!filterCategoriesDblp.article || !!filterCategoriesHal.ART;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Display settings</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" gutterBottom>Ranks</Typography>
        <RankSelector
          selected={filterRanks}
          setSelected={setFilterRanks}
          coreDisabled={!hasAnyConfCategory}
          journalDisabled={!hasAnyJournalCategory}
        />

        <Divider style={{ margin: '24px 0' }} />

        <Typography variant="subtitle1" gutterBottom>DBLP categories</Typography>
        <CategoriesSelector
          selected={filterCategoriesDblp}
          setSelected={setFilterCategoriesDblp}
          categories={dblpCategories}
          disabledKeys={[
            ...(hasAnyCoreRank ? [] : ['inproceedings']),
            ...(hasAnyJournalRank ? [] : ['article']),
          ]}
          disabledReason="Select at least one matching rank to use this category"
        />

        <Divider style={{ margin: '24px 0' }} />

        <Typography variant="subtitle1" gutterBottom>HAL categories</Typography>
        <CategoriesSelector
          selected={filterCategoriesHal}
          setSelected={setFilterCategoriesHal}
          categories={halCategories}
          disabledKeys={[
            ...(hasAnyCoreRank ? [] : ['COMM']),
            ...(hasAnyJournalRank ? [] : ['ART']),
          ]}
          disabledReason="Select at least one matching rank to use this category"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
