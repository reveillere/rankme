import Chip from '@mui/material/Chip';

// A small, light-grey "DOI" pill linking straight to doi.org -- shared by
// Publications.js (dblp) and HalPublications.js so both look the same
// rather than each styling their own. Deliberately not the same
// icon-only "View on HAL" link next to it: that one already reads as
// "open the source record" from its own context (the HAL logo area),
// while a bare icon here wouldn't say what it opens -- a labeled pill does.
export function DoiChip({ url }) {
  if (!url) return null;
  return (
    <Chip
      component="a"
      href={url}
      target="_blank"
      rel="noreferrer"
      clickable
      label="DOI"
      size="small"
      variant="outlined"
      sx={{
        ml: 0.75,
        height: 18,
        fontSize: '0.7rem',
        verticalAlign: 'middle',
        color: 'text.secondary',
        borderColor: 'divider',
        '& .MuiChip-label': { px: 0.75 },
      }}
    />
  );
}
