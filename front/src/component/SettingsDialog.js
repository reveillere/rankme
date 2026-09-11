import { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import Link from '@mui/material/Link';

import { getUseCommunityOverrides, setUseCommunityOverrides } from '../matchOverrides';
import { useFilterSettings } from '../FilterSettingsContext';

export function SettingsDialog({ open, onClose }) {
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

  // Ranking source DOES live in FilterSettingsContext (unlike
  // useCommunityOverrides above): switching it needs to be visible
  // everywhere at once -- every open tab's stream, the toolbar badge, the
  // category filter popover -- without a page reload, which only a shared
  // reactive value (not a plain localStorage read) can do.
  const { rankingSource, setRankingSource } = useFilterSettings();
  const handleRankingSourceChange = (e) => setRankingSource(e.target.value);

  // The edition/year actually being used for CORE/SJR right now -- fetched
  // fresh each time this dialog opens rather than hardcoded, so it can
  // never drift out of date the way a string someone has to remember to
  // bump by hand would (see routes.js's /ranking-editions, which reads
  // each portal's own live in-process state).
  const [editions, setEditions] = useState(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/ranking-editions').then(r => r.json()).then(data => { if (!cancelled) setEditions(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Preferences</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" gutterBottom>Ranking source</Typography>
        <RadioGroup value={rankingSource} onChange={handleRankingSourceChange}>
          <FormControlLabel value="core-sjr" control={<Radio size="small" />} label={<Typography variant="body2">CORE + SJR (default)</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 1.5 }}>
            Conferences ranked by{' '}
            <Link href="http://portal.core.edu.au/conf-ranks/" target="_blank" rel="noreferrer">CORE</Link> (A*, A, B, C),
            journals by{' '}
            <Link href="https://www.scimagojr.com/" target="_blank" rel="noreferrer">SJR / Scimago</Link> (Q1–Q4) —
            each publication matched against whichever edition was current the year it came out.
            Latest available: CORE {editions?.core ?? '…'}, SJR {editions?.sjr ?? '…'}.
          </Typography>
          <FormControlLabel value="ccf" control={<Radio size="small" />} label={<Typography variant="body2">CCF</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5 }}>
            Ranks both conferences and journals on one shared A/B/C scale by the{' '}
            <Link href="https://www.ccf.org.cn/Academic_Evaluation/By_category/" target="_blank" rel="noreferrer">CCF</Link>,
            the same way — matched against the edition current when each paper was published.
            Latest available: {editions?.ccf ?? '…'}.
          </Typography>
        </RadioGroup>
        <Divider sx={{ mt: 2, mb: 2.5 }} />

        <Typography variant="subtitle1" gutterBottom>Match corrections</Typography>
        <FormControlLabel
          control={<Checkbox checked={useCommunityOverrides} onChange={handleCommunityOverridesChange} size="small" />}
          label={<Typography variant="body2">Use community-confirmed corrections</Typography>}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5 }}>
          When a match gets corrected the same way by several different people, everyone sees that correction
          by default. Your own corrections (see &quot;My match corrections&quot;) always take priority over this.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
