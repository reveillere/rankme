import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import { ExportButton } from './ExportButton';
import { downloadTextFile } from '../exportPublications';

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
  const exportData = () => {
    const data = members.map(m => ({ [m.idKind]: m.id, ...(m.label && m.label !== m.id ? { label: m.label } : {}) }));
    return data;
  };
  const handleExportJson = () => {
    const data = exportData();
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
  const handleExportMarkdown = () => downloadTextFile('rankme-members.md', `# ${title}\n\n${members.map(m => `- ${m.label || m.id} (${m.idKind}: ${m.id})`).join('\n')}\n`, 'text/markdown;charset=utf-8;');
  const handleExportCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    downloadTextFile('rankme-members.csv', ['name,id_kind,id', ...members.map(m => [m.label || '', m.idKind, m.id].map(quote).join(','))].join('\n'), 'text/csv;charset=utf-8;');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <span>{title}</span>
        <ExportButton onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={members.length === 0} />
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <MemberList members={members} />
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function MemberList({ members, onDelete }) {
  return <List dense disablePadding>{members.map((m, i) => (
    <ListItem key={`${m.id}-${i}`} disableGutters sx={{ px: 2, py: 1 }} secondaryAction={onDelete && <IconButton size="small" onClick={() => onDelete(m.id)} aria-label="remove member"><DeleteIcon fontSize="small" /></IconButton>}>
      <Typography variant="body2">{m.label && m.label !== m.id && <strong>{m.label}</strong>}{m.label && m.label !== m.id && ' '}<span style={{ fontStyle: 'italic' }}>({m.idKind}: {m.id})</span></Typography>
    </ListItem>
  ))}</List>;
}
