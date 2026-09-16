import { useCallback, useEffect, useRef, useState } from 'react';

// Material-UI Components
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';

import { fetchIdentityLinks, deleteIdentityLink, importIdentityLinks, postIdentityLink } from '../identityResolution';

// Management panel for personLinks (api/src/identityResolution.js), opened
// from Team.js/Structure.js's own "Manage identity links" icon next to the
// pre-existing "View members" eye icon (MemberListDialog.js). Unlike that
// read-only member list, this one only ever shows members that already
// HAVE a confirmed link on file -- fetchIdentityLinks queries personLinks
// filtered down to this team/structure's own idHals/pids, it is not the
// membership list itself -- and lets the maintainer delete or repoint a
// link, or bulk import/export the set, without going back through the
// cross-check flow that originally created each one.
//
// idHal is personLinks' own unique key (see identityResolution.js), so
// "editing" a row only ever changes its pid -- postIdentityLink re-upserts
// the same idHal with a new pid, exactly the write path a cross-check
// manual confirmation already makes. Changing which idHal a pid belongs to
// would mean deleting one document and creating another under a different
// key, a materially different operation this panel doesn't attempt.
//
// GET /api/identity/links only ever returns {idHal, pid, source, createdAt}
// -- no name, and deliberately not extended to fetch one (a name lookup for
// an arbitrary pid/idHal has no cheap batched form on either side -- see
// identityResolution.js's own module header on dblp's ORCID coverage for the
// kind of per-id cost that would imply). `resolveName`, if the caller
// supplies one, is instead a pure client-side lookup into a name map
// Team.js/Structure.js already built from data they'd loaded anyway (team
// member labels, or a structure's publications-derived idHal->name map --
// see MemberListDialog.js's own comment) -- never a network call from here.
// Optional and defensive (`resolveName?.(...)`) so a caller that hasn't
// built one yet still renders, just without names.
export function IdentityLinksPanel({ open, onClose, idHals = [], pids = [], resolveName }) {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState(null);
  const [editingIdHal, setEditingIdHal] = useState(null);
  const [editValue, setEditValue] = useState('');
  const importFileInputRef = useRef();

  // Keyed off the joined id lists rather than the arrays themselves: Team.js/
  // Structure.js already memoize the arrays they pass down, but joining here
  // too means this doesn't have to trust every future caller to do the same.
  const idHalsKey = idHals.join(',');
  const pidsKey = pids.join(',');
  const refresh = useCallback(() => {
    setLinks(null);
    setError(null);
    fetchIdentityLinks({ idHals, pids })
      .then(setLinks)
      .catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHalsKey, pidsKey]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = (idHal) => {
    deleteIdentityLink(idHal).then(refresh).catch(err => setError(err.message));
  };

  const startEdit = (link) => {
    setEditingIdHal(link.idHal);
    setEditValue(link.pid);
  };

  const handleSaveEdit = (idHal) => {
    const pid = editValue.trim();
    if (!pid) return;
    postIdentityLink({ idHal, pid })
      .then(() => { setEditingIdHal(null); refresh(); })
      .catch(err => setError(err.message));
  };

  // Same mechanics as Teams.js's own handleExportTeams -- a client-side
  // Blob download, no server round trip (the data's already in hand from
  // the last fetch).
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(links, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankme-identity-links.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Same mechanics as Teams.js's own handleImportTeamsFile -- accepts either
  // a bare exported array or a re-uploaded single-object file, so a file
  // this same panel just exported (or a hand-edited subset of it) imports
  // back in without special-casing. Server-side validation (importLinksCore)
  // is what actually screens each entry -- this only needs to get the file
  // into an array to send.
  const handleImportFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setError('Invalid JSON file');
        return;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      importIdentityLinks(list)
        .then(refresh)
        .catch(err => setError(err.message));
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Identity links</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={!links || links.length === 0} sx={{ textTransform: 'none' }}>
            Export
          </Button>
          <Tooltip title='Expected JSON format: an array of {"idHal": "...", "pid": "..."} objects (or a single such object).'>
            <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => importFileInputRef.current?.click()} sx={{ textTransform: 'none' }}>
              Import
            </Button>
          </Tooltip>
          <input ref={importFileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportFile} />
        </Box>

        {links === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : links.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No confirmed identity link for these members yet.</Typography>
        ) : (
          <List dense>
            {links.map(link => {
              const idHalName = resolveName?.(link.idHal);
              const pidName = resolveName?.(link.pid);
              return (
              <ListItem key={link.idHal} divider sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <span>{idHalName ? `${idHalName} ` : ''}(idHal: {link.idHal})</span>
                  <span>&harr;</span>
                  {editingIdHal === link.idHal ? (
                    <span>
                      (pid: <TextField
                        size="small"
                        variant="standard"
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        sx={{ width: 160 }}
                      />)
                    </span>
                  ) : (
                    <span>{pidName ? `${pidName} ` : ''}(pid: {link.pid})</span>
                  )}
                  <span style={{ color: '#8a8f94', fontStyle: 'italic' }}>({link.source})</span>
                </Typography>
                {editingIdHal === link.idHal ? (
                  <>
                    <Button size="small" onClick={() => handleSaveEdit(link.idHal)} sx={{ textTransform: 'none' }}>Save</Button>
                    <Button size="small" onClick={() => setEditingIdHal(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
                  </>
                ) : (
                  <Tooltip title="Edit pid">
                    <IconButton size="small" onClick={() => startEdit(link)} aria-label="edit">
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Delete link">
                  <IconButton size="small" onClick={() => handleDelete(link.idHal)} aria-label="delete">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
