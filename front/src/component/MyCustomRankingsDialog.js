import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

import {
  listProfiles, createProfile, renameProfile, deleteProfile, deleteEntryEdition,
  profileToCSV, allProfilesToCSV, importProfilesFromCSV, peekProfileNameFromCSV, axesForReference,
  allProfilesToJSON, importProfilesFromJSON,
} from '../customRankings';
import { useFilterSettings } from '../FilterSettingsContext';

const REFERENCE_LABEL = { core: 'CORE', sjr: 'SJR', ccf: 'CCF' };

// One entry's per-edition chips, with unit deletion -- the finer-grained
// counterpart to RankDetailsPopover.js's own "Clear this venue's custom
// entry" button, which only ever removes a whole entry across every
// edition at once. Kept here rather than in the popover: reviewing/cleaning
// up a profile as a whole is this dialog's job, the popover's is assigning
// a letter while looking at one specific publication.
function EntryRow({ profileId, entry, onChanged }) {
  const editions = Object.entries(entry.byEdition).sort(([a], [b]) => (a === 'ALL' ? -1 : b === 'ALL' ? 1 : Number(a) - Number(b)));
  const handleRemoveEdition = (edition) => {
    deleteEntryEdition(profileId, entry.key, edition === 'ALL' ? 'ALL' : edition);
    onChanged();
  };
  return (
    <ListItem alignItems="flex-start" sx={{ pl: 4 }}>
      <ListItemText
        primary={
          <Typography variant="body2">
            {entry.title || entry.queryText || 'Unknown venue'}{entry.acronym ? ` (${entry.acronym})` : ''}
          </Typography>
        }
        secondaryTypographyProps={{ component: 'div' }}
        secondary={
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {editions.map(([edition, value]) => (
              <Chip
                key={edition}
                size="small"
                label={`${edition === 'ALL' ? 'All editions' : edition}: ${value}`}
                onDelete={() => handleRemoveEdition(edition)}
              />
            ))}
          </Box>
        }
      />
    </ListItem>
  );
}

// A profile's name, entry count, which axis (if any) currently has it
// selected, rename/delete, and its expandable entry list -- mirrors
// MyOverridesDialog.js's per-correction row, one level up (a profile
// contains several entries, a match correction is already the leaf).
function ProfileRow({ profile, isFirst, activeAxes, expanded, onToggleExpand, onChanged }) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const entryCount = Object.keys(profile.entries).length;

  const commitRename = () => {
    renameProfile(profile.id, nameDraft);
    setRenaming(false);
    onChanged();
  };

  const handleDelete = () => {
    // No confirmation dialog: deleting a profile currently selected as an
    // axis's source is itself harmless (FilterSettingsContext.js's own
    // self-healing falls the axis back to CORE/SJR the instant this
    // fires) -- same "undo by re-creating/re-importing" safety net
    // MyOverridesDialog.js's own per-correction Reset already relies on,
    // just one level up.
    deleteProfile(profile.id);
    onChanged();
  };

  return (
    <div key={profile.id}>
      {!isFirst && <Divider component="li" sx={{ listStyleType: 'none' }} />}
      <ListItem
        alignItems="flex-start"
        sx={{ pr: 14 }}
        secondaryAction={
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
            <IconButton size="small" onClick={() => onToggleExpand(profile.id)} aria-label="toggle entries">
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
            <IconButton size="small" onClick={() => setRenaming(true)} aria-label="rename">
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleDelete} aria-label="delete">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <ListItemText
          primary={
            renaming ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TextField
                  size="small"
                  autoFocus
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                />
                <IconButton size="small" onClick={commitRename} aria-label="save name"><CheckIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => setRenaming(false)} aria-label="cancel rename"><CloseIcon fontSize="small" /></IconButton>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{profile.name}</Typography>
                {/* The reference is immutable (see customRankings.js's own
                    createProfile comment), so this is purely informational
                    -- no rename-the-reference control exists. */}
                <Chip size="small" variant="outlined" label={`base: ${REFERENCE_LABEL[profile.reference] ?? profile.reference}`} />
              </Box>
            )
          }
          secondary={
            <>
              {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
              {' — eligible for: '}{axesForReference(profile.reference).map(a => a === 'conference' ? 'Conferences' : 'Journals').join(', ')}
              {activeAxes.length > 0 && ` — currently active for: ${activeAxes.join(', ')}`}
            </>
          }
        />
      </ListItem>
      {expanded && (
        <List dense disablePadding>
          {Object.values(profile.entries).length === 0
            ? <ListItem sx={{ pl: 4 }}><Typography variant="body2" color="text.secondary">No entries yet -- assign a letter from a publication&apos;s rank badge.</Typography></ListItem>
            : Object.values(profile.entries).map(entry => (
              <EntryRow key={entry.key} profileId={profile.id} entry={entry} onChanged={onChanged} />
            ))}
        </List>
      )}
    </div>
  );
}

// Every custom ranking profile (see customRankings.js) this browser knows
// about -- the management counterpart to editing entries one at a time from
// RankDetailsPopover.js, same relationship MyOverridesDialog.js already has
// to match corrections. Opened from App.js's toolbar (next to "My match
// corrections") and from SettingsDialog.js's own "Manage custom rankings"
// link, both driving the exact same dialog instance/open-state.
export function MyCustomRankingsDialog({ open, onClose }) {
  const { conferenceSource, journalSource } = useFilterSettings();
  const [profiles, setProfiles] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [newName, setNewName] = useState('');
  // 'core' default: matches CONFERENCE_SOURCES/JOURNAL_SOURCES' own default
  // (CORE for conferences, SJR for journals) being listed first there too.
  const [newReference, setNewReference] = useState('core');
  const [importMessage, setImportMessage] = useState(null);
  // Set while a chosen CSV file is waiting on the user to confirm (or
  // change) a name for whichever profile it would newly create, instead of
  // importProfilesFromCSV silently taking the CSV's own profileName column
  // (or falling back to the generic 'Imported ranking') -- see
  // customRankings.js's own nameOverride comment. `text` is the file's
  // already-read contents (read once, up front, so confirming doesn't need
  // to re-read the file), `suggestedName` seeds the TextField from the
  // CSV's own profileName column when it has one.
  const [pendingImport, setPendingImport] = useState(null);
  const [importNameDraft, setImportNameDraft] = useState('');
  const fileInputRef = useRef();
  const jsonFileInputRef = useRef();

  const refresh = () => setProfiles(listProfiles());

  useEffect(() => {
    if (open) { refresh(); setImportMessage(null); }
  }, [open]);

  // Kept live even while open (not just refreshed on open): editing an
  // entry from RankDetailsPopover.js while this dialog also happens to be
  // open (both are reachable from the toolbar at once) should show up here
  // immediately, same as everywhere else this event drives a refresh (see
  // useOverrideRefreshTick.js).
  useEffect(() => {
    window.addEventListener('rankme:customrankingchange', refresh);
    return () => window.removeEventListener('rankme:customrankingchange', refresh);
  }, []);

  const toggleExpand = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createProfile(newName, newReference);
    setNewName('');
    refresh();
  };

  const handleExportOne = (profileId) => {
    const profile = profiles.find(p => p.id === profileId);
    const blob = new Blob([profileToCSV(profileId)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankme-custom-ranking-${(profile?.name || profileId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAll = () => {
    const blob = new Blob([allProfilesToCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankme-custom-rankings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // JSON export -- see customRankings.js's own allProfilesToJSON comment:
  // also what api/src/recordPresentation.js's `customRankings` request
  // parameter expects, so this file can be forwarded to the API as-is.
  const handleExportAllJson = () => {
    const blob = new Blob([allProfilesToJSON()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankme-custom-rankings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportJsonClick = () => jsonFileInputRef.current?.click();

  // No confirm-name step here unlike CSV import: a JSON export already
  // carries each profile's own real `name` field (CSV instead repeats one
  // profileName per row, ambiguous enough on re-import to need
  // peekProfileNameFromCSV/nameOverride -- see handleImportFile below), so
  // importProfilesFromJSON can run straight away.
  const handleImportJsonFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const count = importProfilesFromJSON(text);
      refresh();
      setImportMessage({ severity: 'success', text: `Imported ${count} ranking${count === 1 ? '' : 's'}.` });
    } catch (error) {
      setImportMessage({ severity: 'error', text: `Import failed: ${error.message}` });
    }
  };

  // Reads the file and stops here -- importProfilesFromCSV itself isn't
  // called until the user confirms a name below (handleConfirmImport), so a
  // newly-created profile is never silently named from whatever text
  // happened to be in the CSV's own profileName column.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const text = await file.text();
    const suggestedName = peekProfileNameFromCSV(text);
    setPendingImport({ text });
    setImportNameDraft(suggestedName);
  };

  const handleConfirmImport = () => {
    try {
      const count = importProfilesFromCSV(pendingImport.text, { nameOverride: importNameDraft });
      refresh();
      setImportMessage({ severity: 'success', text: `Imported ${count} entry edition${count === 1 ? '' : 's'}.` });
    } catch (error) {
      setImportMessage({ severity: 'error', text: `Import failed: ${error.message}` });
    }
    setPendingImport(null);
    setImportNameDraft('');
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    setImportNameDraft('');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>My custom rankings</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Your own named ranking profiles (letters you&apos;ve assigned by hand), kept in this browser only. Select
          one as the active Conference or Journal source from Preferences.
        </Typography>

        {importMessage && (
          <Alert severity={importMessage.severity} sx={{ mb: 1 }} onClose={() => setImportMessage(null)}>
            {importMessage.text}
          </Alert>
        )}

        {pendingImport && (
          <Alert severity="info" sx={{ mb: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Name this import (only applies to a profile it newly creates -- one already in this
              browser keeps its existing name):
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                autoFocus
                placeholder="Profile name…"
                value={importNameDraft}
                onChange={e => setImportNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirmImport(); if (e.key === 'Escape') handleCancelImport(); }}
              />
              {/* Left blank is a legitimate choice, not disabled: an empty
                  nameOverride is already a no-op in importProfilesFromCSV
                  (falls back to each row's own profileName, or 'Imported
                  ranking'), same as never having asked at all. */}
              <Button size="small" onClick={handleConfirmImport}>Import</Button>
              <Button size="small" onClick={handleCancelImport}>Cancel</Button>
            </Box>
          </Alert>
        )}

        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="New profile name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
            <Button size="small" startIcon={<AddIcon />} onClick={handleCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </Box>
          {/* Immutable once created (see customRankings.js's own
              createProfile comment) -- everything not explicitly overridden
              in this profile falls back to this ranking's own automatic
              value, and it's also what gates which axis(es) the profile can
              later be selected on (axesForReference). */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Based on:</Typography>
            <RadioGroup row value={newReference} onChange={e => setNewReference(e.target.value)}>
              <FormControlLabel value="core" control={<Radio size="small" />} label={<Typography variant="body2">CORE</Typography>} />
              <FormControlLabel value="sjr" control={<Radio size="small" />} label={<Typography variant="body2">SJR</Typography>} />
              <FormControlLabel value="ccf" control={<Radio size="small" />} label={<Typography variant="body2">CCF</Typography>} />
            </RadioGroup>
          </Box>
        </Box>

        {profiles.length === 0 ? (
          <Typography variant="body2" sx={{ py: 2 }}>No custom rankings yet.</Typography>
        ) : (
          <List dense>
            {profiles.map((profile, i) => {
              const activeAxes = [
                conferenceSource === `custom:${profile.id}` ? 'Conferences' : null,
                journalSource === `custom:${profile.id}` ? 'Journals' : null,
              ].filter(Boolean);
              return (
                <Box key={profile.id} sx={{ position: 'relative' }}>
                  <ProfileRow
                    profile={profile}
                    isFirst={i === 0}
                    activeAxes={activeAxes}
                    expanded={expandedIds.has(profile.id)}
                    onToggleExpand={toggleExpand}
                    onChanged={refresh}
                  />
                  <Button
                    size="small"
                    startIcon={<FileDownloadIcon />}
                    onClick={() => handleExportOne(profile.id)}
                    sx={{ ml: 4, mb: 1 }}
                  >
                    Export this profile
                  </Button>
                </Box>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Box>
          <Button size="small" startIcon={<FileDownloadIcon />} onClick={handleExportAll} disabled={profiles.length === 0}>
            Export all
          </Button>
          <Tooltip title="Import rankings from a CSV file"><Button size="small" startIcon={<FileUploadIcon />} onClick={handleImportClick}>
            Import CSV
          </Button></Tooltip>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />
          <Tooltip title="Also the format the public API's customRankings parameter expects">
            <Button size="small" startIcon={<FileDownloadIcon />} onClick={handleExportAllJson} disabled={profiles.length === 0}>
              Export all (JSON)
            </Button>
          </Tooltip>
          <Tooltip title="Import rankings from a JSON file"><Button size="small" startIcon={<FileUploadIcon />} onClick={handleImportJsonClick}>
            Import JSON
          </Button></Tooltip>
          <input ref={jsonFileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportJsonFile} />
        </Box>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
