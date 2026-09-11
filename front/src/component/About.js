import { useState } from 'react';

// Material-UI Components and Icons
import {
  Dialog,
  DialogTitle,
  DialogActions,
  DialogContent,
  Typography,
  IconButton,
  Link,
  Box,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import pkg from '../../package.json';

export const HIDE_ON_START_KEY = 'rankme:hideAboutOnStart';

function About({ open, onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(() => localStorage.getItem(HIDE_ON_START_KEY) === 'true');

  const handleCheckboxChange = (e) => {
    setDontShowAgain(e.target.checked);
    localStorage.setItem(HIDE_ON_START_KEY, e.target.checked ? 'true' : 'false');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, fontWeight: 800 }}>
        rankme
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
          {/* versionDate is bumped by hand alongside version in
              package.json at commit time -- not a build timestamp, so it
              reflects when this version was released, not when it happened
              to be compiled. */}
          v{pkg.version}{pkg.versionDate ? ` · ${pkg.versionDate}` : ''}
        </Typography>
      </DialogTitle>
      <DialogActions style={{ position: 'absolute', right: '8px', top: '8px', padding: '8px' }}>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogActions>
      <DialogContent>
        <Typography variant="body1" gutterBottom>
          rankme looks up an author on <Link href="https://dblp.org" target="_blank" rel="noreferrer">DBLP</Link> or{' '}
          <Link href="https://hal.science" target="_blank" rel="noreferrer">HAL</Link>, pulls their publication list,
          and matches each venue against a ranking source.
        </Typography>
        <Typography variant="body1" gutterBottom>
          By default, conferences and workshops are ranked by{' '}
          <Link href="http://portal.core.edu.au/conf-ranks/" target="_blank" rel="noreferrer">CORE</Link> (A*, A, B, C),
          journals by{' '}
          <Link href="https://www.scimagojr.com/" target="_blank" rel="noreferrer">SJR / Scimago</Link> (Q1–Q4).
          A venue with no match in either source is shown as Unranked rather than left out. You can switch to{' '}
          <Link href="https://www.ccf.org.cn/Academic_Evaluation/By_category/" target="_blank" rel="noreferrer">CCF</Link>{' '}
          instead — a single A/B/C scale covering both conferences and journals — from the ranking badge in the
          toolbar or the Preferences dialog.
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            alignItems: 'flex-start',
            mt: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'warning.light',
            color: 'warning.contrastText',
          }}
        >
          <InfoOutlinedIcon fontSize="small" sx={{ mt: '2px', flexShrink: 0 }} />
          <Typography variant="body2">
            Rank matching is automated and best-effort: venue names and acronyms don&apos;t always line up perfectly
            across DBLP, HAL, CORE and Scimago, so occasional mismatches are expected. Use rankme as a starting point,
            not a definitive assessment.
          </Typography>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
          Proudly built by one human manager and a small team of tireless AI developers — no coffee breaks, occasional hallucinations.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <FormControlLabel
          control={<Checkbox size="small" checked={dontShowAgain} onChange={handleCheckboxChange} />}
          label={<Typography variant="body2">Don&apos;t show this again</Typography>}
          sx={{ mr: 'auto' }}
        />
      </DialogActions>
    </Dialog>
  );
}

export default About;
