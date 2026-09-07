import Tooltip from '@mui/material/Tooltip';

// rank.exact === false means the ranking API only found a plausible match
// (a fuzzy title match, or a tie-break among several same-acronym entries)
// rather than a confirmed one -- flagged here so a possibly-wrong grade
// isn't shown with the same confidence as a verified one. rank.msg (the
// tooltip) names what it actually matched against.
export function RankBadge({ rank }) {
  if (!rank) return null;
  const uncertain = rank.exact === false;

  return (
    <Tooltip title={<div>{rank.msg}</div>} placement="bottom">
      <span style={uncertain ? { color: '#e07b00' } : undefined}>
        {rank.value}
      </span>
    </Tooltip>
  );
}
