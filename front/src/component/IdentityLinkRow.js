import { Box, Button, IconButton, ListItem, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

// Shared by authors, teams, structures and the complete personal-links list.
export function IdentityLinkRow({ member, source, onSelect, onConfirm, onDelete }) {
  const inverse = source === 'dblp';
  const ownId = inverse ? member.pid : member.idHal;
  const candidates = member.candidates || [];
  const counterpart = member.resolved || (candidates.length === 1 ? candidates[0] : null);
  const counterpartId = inverse ? counterpart?.idHal : counterpart?.pid;
  const CounterpartIcon = member.resolved ? LinkIcon : HelpOutlineIcon;

  return <ListItem disableGutters sx={{ py: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
    <Typography variant="body2" sx={{ flex: 1 }}>
      <strong>{member.name || ownId}</strong> <span style={{ fontStyle: 'italic' }}>({inverse ? 'pid' : 'idHal'}: {ownId})</span>
      {counterpart && <>
        <br /><CounterpartIcon fontSize="inherit" color="action" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />
        {!member.resolved && 'candidate: '}{counterpart.name || ''} <span style={{ fontStyle: 'italic' }}>({inverse ? 'idHal' : 'pid'}: {counterpartId})</span>
        {member.resolved && <span style={{ color: '#8a8f94', fontStyle: 'italic' }}> ({counterpart.source})</span>}
      </>}
      {!counterpart && candidates.length > 0 && <>
        <br /><HelpOutlineIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />
        {candidates.length} {inverse ? 'HAL' : 'DBLP'} candidates found (unconfirmed)
      </>}
    </Typography>
    <Box sx={{ display: 'flex', gap: 1 }}>
      {member.resolved
        ? counterpart.source === 'local'
          ? <Tooltip title="Delete personal link"><IconButton color="error" size="small" onClick={() => onDelete(member)} aria-label="Delete personal link"><DeleteIcon color="error" fontSize="small" /></IconButton></Tooltip>
          : <Button size="small" onClick={() => onConfirm(member, counterpart)}>Save locally</Button>
        : <>
          {counterpart && <Button size="small" variant="contained" onClick={() => onConfirm(member, counterpart)} sx={{ textTransform: 'none' }}>Confirm</Button>}
          <Button size="small" variant="outlined" onClick={() => onSelect(member)} sx={{ textTransform: 'none' }}>Select</Button>
        </>}
    </Box>
  </ListItem>;
}
