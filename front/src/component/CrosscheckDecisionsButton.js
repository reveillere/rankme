import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, Typography } from '@mui/material';
import { listCrosscheckDecisions, importLocalDecisions, removeCrosscheckDecision, removeCrosscheckDecisions, personalDataFile, reportPublicationKeys } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { downloadTextFile } from '../exportPublications';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';
import { ImportButton } from './ImportButton';
import { ExportButton } from './ExportButton';
import DeleteIcon from '@mui/icons-material/Delete';

// Report exports describe the results; this separate file contains editable
// decisions and can be merged by collaborators without importing their report.
export function CrosscheckDecisionsButton({ report, scope = { type: 'all' }, buttonVariant = 'outlined', startIcon }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const input = useRef();
  usePersonalDataVersion();
  const keys = report ? reportPublicationKeys(report) : undefined;
  let decisions = [];
  let storageError;
  try { decisions = listCrosscheckDecisions(keys); } catch (error) { storageError = error.message; }
  const title = scope.type === 'all' ? 'My cross-check decisions' : 'Cross-check decisions for this ' + scope.type;
  const filename = `rankme-crosscheck-decisions-${scope.type}-${String(scope.id || scope.pid || 'all').replace(/[^a-zA-Z0-9_-]/g, '-')}.json`;
  const importFile = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('File too large (maximum 5 MB).');
      const result = importLocalDecisions(JSON.parse(await file.text()), keys);
      setNotice({ severity: 'success', text: `${result.imported} decisions imported into this browser.` });
    } catch (error) { setNotice({ severity: 'error', text: error.message }); }
  };
  const remove = entry => {
    try { removeCrosscheckDecision(entry); setNotice(null); }
    catch (error) { setNotice({ severity: 'error', text: error.message }); }
  };
  const resetAll = () => {
    try {
      removeCrosscheckDecisions(keys);
      setResetOpen(false);
      setNotice(null);
    } catch (error) { setNotice({ severity: 'error', text: error.message }); }
  };
  return <>
    <Button size="small" variant={buttonVariant} startIcon={startIcon} onClick={() => setOpen(true)}>{scope.type === 'all' ? title : 'My cross-check decisions'}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <span>{title}</span>
        <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
          <ExportButton title={`Export cross-check decisions (${decisions.length})`} disabled={!decisions.length} updateUrl={false} onExportJson={() => downloadTextFile(filename, JSON.stringify(personalDataFile('crosscheck-decisions', decisions, scope), null, 2), 'application/json')} />
          <ImportButton title="Import cross-check decisions" onImportJson={() => input.current?.click()} />
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>Saved in this browser only. Share this JSON file together with the identity links file to collaborate. Import merges decisions; an imported decision replaces your choice for the same publication pair. Other choices are kept.</Typography>
        {scope.type !== 'all' && <Typography variant="body2" sx={{ mb: 2 }}>Includes all publications in this report, regardless of the year filter.</Typography>}
        {(storageError || notice) && <Alert severity={storageError ? 'error' : notice.severity}>{storageError || notice.text}</Alert>}
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={importFile} />
        {!decisions.length && <Typography color="text.secondary">No personal decisions in this scope.</Typography>}
        <List>{decisions.map(entry => <ListItem key={JSON.stringify([entry.dblpKey, entry.halDocid])} sx={{ gap: 2 }}>
          <Typography sx={{ flex: 1, overflowWrap: 'anywhere' }}>{entry.dblpKey} ↔ HAL {entry.halDocid}: {entry.decision === 'same' ? 'Same publication' : 'Different publications'}</Typography>
          <Tooltip title="Delete decision"><IconButton color="error" size="small" onClick={() => remove(entry)} aria-label="delete decision"><DeleteIcon color="error" fontSize="small" /></IconButton></Tooltip>
        </ListItem>)}</List>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button color="error" startIcon={<DeleteIcon />} disabled={!decisions.length} onClick={() => setResetOpen(true)}>Delete all</Button>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </DialogActions>
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete all decisions?</DialogTitle>
        <DialogContent><Typography>This will delete all {decisions.length} decisions in this scope from this browser.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button color="error" onClick={resetAll}>Delete all</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  </>;
}

// Compact controls for a cross-check page. The full list/undo management
// remains available from Settings; on the report itself these are deliberately
// just the two familiar file actions, so they cannot be confused with the
// report export beside them.
export function CrosscheckDecisionFileButtons({ report, scope }) {
  const input = useRef();
  const [notice, setNotice] = useState(null);
  usePersonalDataVersion();
  const keys = report ? reportPublicationKeys(report) : undefined;
  let decisions = [];
  try { decisions = listCrosscheckDecisions(keys); } catch (error) { /* Settings exposes storage errors in detail. */ }
  const filename = `rankme-crosscheck-decisions-${scope.type}-${String(scope.id || scope.pid || 'all').replace(/[^a-zA-Z0-9_-]/g, '-')}.json`;
  const importFile = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('File too large (maximum 5 MB).');
      const result = importLocalDecisions(JSON.parse(await file.text()), keys);
      setNotice(`${result.imported} decision(s) imported`);
    } catch (error) { setNotice(error.message); }
  };
  return <>
    <ImportButton title={notice || 'Import cross-check decisions'} onImportJson={() => input.current?.click()} />
    <Tooltip title={`Export my cross-check decisions (${decisions.length})`}>
      <span>
        <IconButton size="small" color="primary" aria-label="export cross-check decisions" disabled={!decisions.length} onClick={() => downloadTextFile(filename, JSON.stringify(personalDataFile('crosscheck-decisions', decisions, scope), null, 2), 'application/json')} sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}>
          <DownloadIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={importFile} />
  </>;
}
