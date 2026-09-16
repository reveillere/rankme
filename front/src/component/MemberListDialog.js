import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import DownloadIcon from '@mui/icons-material/Download';

// Shared by Team.js and Structure.js's own "view members" eye icon.
// A team member may carry a resolved `label` (set from a search result --
// see Teams.js's addMember) -- a HAL structure's memberIds never did either,
// until Structure.js started building its own idHal->name map from
// publications already loaded for the page (no extra request, same
// AuthorHalContent-style resolution -- see that file's own name-resolution
// effect) and filling `label` from it the same way. Either way the id itself
// is always shown with its kind prefixed (idKind), same convention as
// Author.js/AuthorHal.js's own "pid:"/"idHal:" line and Teams.js's chip
// rendering, so a bare id is never shown unlabeled. A HAL structure can run
// into the hundreds of members, so the list scrolls inside a bounded box
// rather than growing the dialog past the viewport. `title` is expected to
// already carry the member count (see Team.js/Structure.js's own callers) --
// this component just renders whatever string it's given.
export function MemberListDialog({ open, onClose, title, members }) {
  // Same mechanics as IdentityLinksPanel.js's own handleExport/Teams.js's
  // handleExportTeams -- a client-side Blob download, no server round trip
  // (the list is already in hand, built by the caller). Exports the list
  // exactly as shown: id + label when one is known.
  const handleExport = () => {
    const data = members.map(m => ({ [m.idKind]: m.id, ...(m.label && m.label !== m.id ? { label: m.label } : {}) }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankme-members.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={members.length === 0} sx={{ textTransform: 'none' }}>
            Export
          </Button>
        </Box>
        <Box sx={{ maxHeight: '60vh', overflow: 'auto' }}>
          <List dense>
            {members.map((m, i) => (
              <ListItem key={`${m.id}-${i}`} divider>
                {m.label && m.label !== m.id ? (
                  <ListItemText
                    primary={m.label}
                    secondary={<span style={{ fontStyle: 'italic', color: '#8a8f94' }}>{m.idKind}: {m.id}</span>}
                  />
                ) : (
                  <ListItemText primary={<span style={{ fontStyle: 'italic' }}>{m.idKind}: {m.id}</span>} />
                )}
              </ListItem>
            ))}
          </List>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
