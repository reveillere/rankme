// Material-UI Components and Icons
import {
  Dialog,
  DialogTitle,
  DialogActions,
  DialogContent,
  Typography,
  IconButton,
  Link,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';


function About({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle style={{ fontWeight: '800'}}>About RankMe</DialogTitle>
      <DialogActions style={{ position: 'absolute', right: '8px', top: '8px', padding: '8px' }}>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogActions>
      <DialogContent>
        <Typography variant="body1" gutterBottom>
          RankMe looks up an author on <Link href="https://dblp.org" target="_blank" rel="noreferrer">DBLP</Link> or{' '}
          <Link href="https://hal.science" target="_blank" rel="noreferrer">HAL</Link>, pulls their publication list,
          and matches each venue against two independent ranking sources.
        </Typography>
        <Typography variant="body1" gutterBottom>
          Conferences and workshops are ranked by{' '}
          <Link href="http://portal.core.edu.au/conf-ranks/" target="_blank" rel="noreferrer">CORE</Link> (A*, A, B, C),
          journals by{' '}
          <Link href="https://www.scimagojr.com/" target="_blank" rel="noreferrer">SJR / Scimago</Link> (Q1–Q4).
          A venue with no match in either source is shown as Unranked rather than left out.
        </Typography>
        <Typography variant="body1" gutterBottom>
          Each author page charts publications by rank over time. Use <strong>Filter</strong> to narrow the year
          range, and the settings icon (<em>⚙</em>) in the top bar to choose which ranks and publication
          categories are taken into account everywhere — that choice applies across every open author page.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Rank matching is automated and best-effort: venue names and acronyms don&apos;t always line up perfectly
          across DBLP, HAL, CORE and Scimago, so occasional mismatches are expected.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

export default About;
