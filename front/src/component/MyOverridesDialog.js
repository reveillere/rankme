import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';

import { listOverrides, clearOverride, clearAllOverrides, overridesToCSV, importOverridesFromCSV } from '../matchOverrides';

// Every CORE/SJR match a user has manually corrected in RankDetailsPopover,
// kept in this browser's localStorage (see matchOverrides.js) -- this is
// just the visible list of that local state, so a user can review or undo
// what they've changed, or export/import it as a CSV file (e.g. to carry
// corrections over to another browser). A copy of each correction is also
// mirrored to the server when it's made, but that server-side copy is for
// later analysis only and isn't shown here or read back.
export function MyOverridesDialog({ open, onClose }) {
  const [overrides, setOverrides] = useState([]);
  const [importMessage, setImportMessage] = useState(null);
  const fileInputRef = useRef();

  useEffect(() => {
    if (open) { setOverrides(listOverrides()); setImportMessage(null); }
  }, [open]);

  const handleReset = (key) => {
    clearOverride(key);
    setOverrides(listOverrides());
  };

  const handleClearAll = () => {
    clearAllOverrides();
    setOverrides([]);
  };

  const handleExport = () => {
    const blob = new Blob([overridesToCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankme-match-corrections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    try {
      const text = await file.text();
      const count = importOverridesFromCSV(text);
      setOverrides(listOverrides());
      setImportMessage({ severity: 'success', text: `Imported ${count} correction${count === 1 ? '' : 's'}.` });
    } catch (error) {
      setImportMessage({ severity: 'error', text: `Import failed: ${error.message}` });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>My match corrections</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Corrections you&apos;ve made to CORE/SJR/CCF matches, kept in this browser only.
        </Typography>

        {importMessage && (
          <Alert severity={importMessage.severity} sx={{ mb: 1 }} onClose={() => setImportMessage(null)}>
            {importMessage.text}
          </Alert>
        )}

        {overrides.length === 0 ? (
          <Typography variant="body2" sx={{ py: 2 }}>No corrections yet.</Typography>
        ) : (
          <List dense>
            {overrides.map((o, i) => (
              <div key={o.key}>
                {/* App.css sets a global `li { list-style-type: square }` for
                    the publication lists elsewhere in the app; ListItem
                    escapes it by being display:flex, but a plain <li>
                    Divider doesn't, so it shows a stray square marker
                    without this override. */}
                {i > 0 && <Divider component="li" sx={{ listStyleType: 'none' }} />}
                <ListItem
                  secondaryAction={
                    <Button size="small" onClick={() => handleReset(o.key)}>Reset</Button>
                  }
                >
                  <ListItemText
                    primary={
                      <>
                        <Chip label={o.portal === 'core' ? 'CORE' : o.portal === 'ccf' ? 'CCF' : 'SJR'} size="small" sx={{ mr: 1 }} />
                        {o.type === 'confirmed' && <Chip label="Confirmed" size="small" color="success" variant="outlined" sx={{ mr: 1 }} />}
                        {/* markAsUnranked's candidate (RankDetailsPopover.js) has no
                            title at all -- just value: 'Unranked' -- so fall back to
                            that instead of rendering an empty title. */}
                        {o.candidate.title || o.candidate.value}{o.candidate.acronym ? ` (${o.candidate.acronym})` : ''} — {o.candidate.value}
                      </>
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                    secondary={
                      <>
                        {/* The actual publication text this correction applies to
                            -- always shown, not just for a plain override: "Was"
                            below is what the *automatic match* guessed, which is
                            a different (and, for a confirmation, entirely absent)
                            piece of information from what the venue itself says. */}
                        {o.queryText && <div>Original text: &quot;{o.queryText}&quot;</div>}
                        {o.type !== 'confirmed' && (
                          <div>Was: {o.previous?.matchedTitle ? `"${o.previous.matchedTitle}" — ${o.previous.value}` : `unmatched (${o.previous?.value ?? '?'})`}</div>
                        )}
                        <div>{o.year ? `Publication year: ${o.year} — ` : ''}Edition: {o.rankSource}</div>
                      </>
                    }
                  />
                </ListItem>
              </div>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Box>
          <Button size="small" startIcon={<FileDownloadIcon />} onClick={handleExport} disabled={overrides.length === 0}>
            Export CSV
          </Button>
          <Button size="small" startIcon={<FileUploadIcon />} onClick={handleImportClick}>
            Import CSV
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />
        </Box>
        <Box>
          {overrides.length > 0 && <Button color="error" onClick={handleClearAll}>Reset all</Button>}
          <Button onClick={onClose}>Close</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
