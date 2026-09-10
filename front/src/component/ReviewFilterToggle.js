import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';

// Shared by Author.js/AuthorHal.js/Team.js/Structure.js: a toggle that
// narrows the publication list to matches worth a second look (fuzzy,
// ambiguous, or no match at all -- see needsReview in matchOverrides.js).
// Left-aligned right above the list itself, rather than next to the
// year-range FilterButton above the chart, since it's a property of the
// list being reviewed, not a chart filter. Hidden entirely when count is 0
// -- an always-visible checkbox that never has anything to do reads as
// dead UI once everything's already been resolved.
export function ReviewFilterToggle({ count, checked, onChange }) {
  if (count === 0) return null;
  return (
    <div style={{ width: '100%', textAlign: 'left', paddingLeft: '40px', marginBottom: '8px' }}>
      <FormControlLabel
        control={<Checkbox checked={checked} onChange={e => onChange(e.target.checked)} size="small" />}
        label={
          <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
            Only show matches to review ({count})
          </Typography>
        }
      />
    </div>
  );
}
