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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import pkg from '../../package.json';
import { CHANGELOG } from '../changelog';

export const HIDE_ON_START_KEY = 'rankme:hideAboutOnStart';

// A Tally.so form (free, no rankme-side account/API calls needed since it's
// just an outbound link) -- manage it at https://tally.so/forms/dWrv0y/edit.
const FEEDBACK_URL = 'https://tally.so/r/dWrv0y';

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
          Conferences and workshops are ranked using{' '}
          <Link href="http://portal.core.edu.au/conf-ranks/" target="_blank" rel="noreferrer">CORE</Link> (A*, A, B, C)
          or{' '}
          <Link href="https://www.ccf.org.cn/Academic_Evaluation/By_category/" target="_blank" rel="noreferrer">CCF</Link>{' '}
          (A, B, C); journals using{' '}
          <Link href="https://www.scimagojr.com/" target="_blank" rel="noreferrer">SJR / Scimago</Link> (Q1–Q4) or CCF
          (A, B, C). A venue with no match is shown as Unranked rather than left out, and custom rankings let you
          override individual matches.
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
            across DBLP, HAL, CORE, Scimago and CCF, so occasional mismatches are expected. Use rankme as a starting
            point, not a definitive assessment.
          </Typography>
        </Box>

        <Accordion
          disableGutters
          elevation={0}
          sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>What&apos;s new</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ maxHeight: 280, overflowY: 'auto' }}>
            {CHANGELOG.map(({ version, items }) => (
              <Box key={version} sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" color="text.secondary">v{version}</Typography>
                <List dense disablePadding sx={{ listStyleType: 'disc', pl: 2.5 }}>
                  {items.map((item, i) => (
                    <ListItem key={i} disableGutters sx={{ display: 'list-item', py: 0.25 }}>
                      <Typography variant="body2">{item}</Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))}
          </AccordionDetails>
        </Accordion>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          This site uses self-hosted, cookie-free analytics (page views, referrers) to understand usage. No
          personal data or IP address is stored.
        </Typography>

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
        <Link href={FEEDBACK_URL} target="_blank" rel="noreferrer" variant="body2">
          Feedback &amp; ideas
        </Link>
      </DialogActions>
    </Dialog>
  );
}

export default About;
