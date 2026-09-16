import { useState, useRef } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputBase from '@mui/material/InputBase';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import AccountCircle from '@mui/icons-material/AccountCircle';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';

import { searchAuthor as searchAuthorDblp } from '../dblp';
import { searchAuthor as searchAuthorHal } from '../hal';
import { getTeams, createTeam, updateTeam, deleteTeam } from '../teamStore';
import { PersonListItemText } from './PersonListItemText';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

// Mirrors Search.js's per-source config: one source per team (DBLP and HAL
// ids don't overlap, so members stay homogeneous within a team).
const SOURCES = {
  dblp: {
    label: 'DBLP',
    search: searchAuthorDblp,
    resultLabel: r => r.author,
    resultId: r => r.pid,
    idLabel: 'PID',
    idPlaceholder: 'e.g. 12/3456',
  },
  hal: {
    label: 'HAL',
    search: searchAuthorHal,
    resultLabel: r => r.author,
    resultId: r => r.id,
    idLabel: 'idHal',
    idPlaceholder: 'e.g. jane-doe',
  },
};

// Team creation reuses the DBLP/HAL name/id lookups already built for the
// single-author Search tab, just accumulating several members into a
// working list before saving instead of opening a tab immediately.
export default function Teams({ onOpenAuthor }) {
  const [teams, setTeams] = useState(() => getTeams());
  const [editingId, setEditingId] = useState(null); // null = creating a new team
  const [name, setName] = useState('');
  // DBLP by default -- see the identical note in Search.js: HAL was only
  // ever the fallback while DBLP needed a live dblp.org fetch (blocked by
  // their anti-bot protection) or the local dump hadn't been imported yet.
  const [source, setSource] = useState('dblp');
  const [members, setMembers] = useState([]); // { id, label }
  const [mode, setMode] = useState('name');
  const [query, setQuery] = useState('');
  const [idInput, setIdInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [results, setResults] = useState([]);
  const debounceRef = useRef();
  const bulkFileInputRef = useRef();
  const teamsFileInputRef = useRef();

  // Members from one source aren't meaningful once you switch to the other
  // — only clear them on an actual user-driven switch, not when loading an
  // existing team into the form for editing (which also sets source).
  const handleSourceChange = (e, newSource) => {
    setSource(newSource);
    setMembers([]);
    setQuery('');
    setIdInput('');
    setBulkInput('');
    setResults([]);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSource('dblp');
    setMembers([]);
    setQuery('');
    setIdInput('');
    setBulkInput('');
    setResults([]);
  };

  const startEdit = (team) => {
    setEditingId(team.id);
    setName(team.name);
    setSource(team.source);
    setMembers(team.members);
    setMode('name');
    setQuery('');
    setIdInput('');
    setBulkInput('');
    setResults([]);
  };

  const runSearch = (text) => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    SOURCES[source].search(encodeURI(trimmed))
      .then(data => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]));
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  };

  const addMember = (id, label) => {
    setMembers(prev => (prev.some(m => m.id === id) ? prev : [...prev, { id, label }]));
    setQuery('');
    setResults([]);
    setIdInput('');
  };

  const removeMember = (id) => setMembers(prev => prev.filter(m => m.id !== id));

  // One id per line, but also tolerate commas/semicolons since a pasted
  // list won't always be newline-separated.
  const addBulkMembers = (text) => {
    const ids = Array.from(new Set(text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)));
    if (ids.length === 0) return;
    setMembers(prev => {
      const existing = new Set(prev.map(m => m.id));
      const additions = ids.filter(id => !existing.has(id)).map(id => ({ id, label: id }));
      return [...prev, ...additions];
    });
    setBulkInput('');
  };

  const handleBulkFileChange = (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addBulkMembers(String(reader.result));
    reader.readAsText(file);
  };

  const canSave = name.trim().length > 0 && members.length >= 2;

  const handleSave = () => {
    if (!canSave) return;
    if (editingId) {
      updateTeam(editingId, { name: name.trim(), source, members });
    } else {
      createTeam(name.trim(), source, members);
    }
    setTeams(getTeams());
    resetForm();
  };

  const handleDelete = (id) => {
    deleteTeam(id);
    setTeams(getTeams());
    if (editingId === id) resetForm();
  };

  // Teams live only in this browser's localStorage (see teamStore.js) --
  // there is no server-side copy, so clearing site data or switching
  // machines loses them silently. Export/import is the only backup/transfer
  // path available.
  const handleExportTeams = () => {
    const blob = new Blob([JSON.stringify(teams, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankme-teams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Imported teams are always created fresh (via createTeam, which mints
  // its own id) rather than restored with their original id -- reusing an
  // id could silently overwrite a same-named-but-different team already in
  // this browser, whereas an extra duplicate is harmless and easy to
  // delete. Invalid entries (missing name/source/members) are skipped
  // rather than aborting the whole import.
  const handleImportTeamsFile = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        return;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const t of list) {
        if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
        if (t.source !== 'dblp' && t.source !== 'hal') continue;
        if (!Array.isArray(t.members) || t.members.length === 0) continue;
        createTeam(t.name.trim(), t.source, t.members);
      }
      setTeams(getTeams());
    };
    reader.readAsText(file);
  };

  // A single team's own JSON, same shape handleImportTeamsFile above already
  // accepts (a bare {name, source, members} object, or an array containing
  // just this one) -- so re-importing this exact file elsewhere (or back
  // into this same browser) works without any special-casing on the import
  // side.
  const handleExportSingleTeam = (team) => {
    const blob = new Blob([JSON.stringify(team, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rankme-team-${team.name.trim().toLowerCase().replace(/\s+/g, '-') || team.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openTeam = (team) => {
    onOpenAuthor({ type: 'team', id: `team:${team.id}`, label: team.name, teamId: team.id });
  };

  return (
    <div className="App">
      <h1>Teams</h1>
      <div style={{ fontSize: 'large', marginTop: '-0.8em', marginBottom: '10px', color: 'GrayText' }}>
        Group several DBLP or HAL authors together and rank their merged, deduplicated publications
      </div>

      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 3 }}>
        {teams.length > 0 && (
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportTeams} sx={{ textTransform: 'none' }}>
            Export teams
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => teamsFileInputRef.current?.click()} sx={{ textTransform: 'none' }}>
          Import teams
        </Button>
        <input ref={teamsFileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportTeamsFile} />
      </Box>

      {teams.length > 0 && (
        <Box sx={{ width: 500, maxWidth: '100%', margin: '0 auto 40px auto', textAlign: 'left' }}>
          <List>
            {teams.map(team => (
              <ListItem
                key={team.id}
                disablePadding
                sx={{ pr: 17 }}
                secondaryAction={
                  <>
                    <IconButton edge="end" aria-label="export" onClick={() => handleExportSingleTeam(team)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    <IconButton edge="end" aria-label="edit" onClick={() => startEdit(team)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(team.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                }
              >
                <ListItemButton onClick={() => openTeam(team)} selected={editingId === team.id}>
                  <GroupsIcon sx={{ mr: 1.5, color: 'text.secondary' }} />
                  <ListItemText
                    primary={team.name}
                    secondary={`${team.members.length} members · ${SOURCES[team.source]?.label || team.source}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Divider sx={{ mt: 3 }} />
        </Box>
      )}

      <Box sx={{ width: 500, maxWidth: '100%', margin: '0 auto', textAlign: 'left' }}>
        <Typography variant="subtitle1" gutterBottom>{editingId ? 'Edit team' : 'New team'}</Typography>

        <TextField
          label="Team name"
          value={name}
          onChange={e => setName(e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />

        <Tabs
          value={source}
          onChange={handleSourceChange}
          sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
        >
          {Object.entries(SOURCES).map(([key, { label }]) => (
            <Tab key={key} value={key} label={label} disabled={!!editingId && key !== source} />
          ))}
        </Tabs>
        {editingId && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5, mb: 1 }}>
            A team&apos;s source can&apos;t be changed after creation.
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" gutterBottom>Add {SOURCES[source].label} members</Typography>

        <ToggleButtonGroup value={mode} exclusive onChange={(e, v) => v && setMode(v)} size="small" sx={{ mb: 1 }}>
          <ToggleButton value="name">By name</ToggleButton>
          <ToggleButton value="id">By {SOURCES[source].idLabel}</ToggleButton>
          <ToggleButton value="bulk">Bulk {SOURCES[source].idLabel}s</ToggleButton>
        </ToggleButtonGroup>

        {mode === 'name' && (
          <Box sx={{ position: 'relative' }}>
            {/* Same Paper + icon + InputBase shape as Search.js's
                AuthorSearchForm -- was a plain TextField here, which looked
                like a different, unrelated search control. */}
            <Paper
              component="form"
              onSubmit={e => e.preventDefault()}
              sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: '100%' }}
            >
              <IconButton sx={{ p: '10px' }} aria-label="menu">
                <AccountCircle />
              </IconButton>
              <InputBase
                sx={{ ml: 1, flex: 1 }}
                placeholder="Author name"
                inputProps={{ 'aria-label': 'Author name' }}
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
              />
            </Paper>
            {results.length > 0 && (
              <Paper sx={{ position: 'absolute', zIndex: 1, width: '100%', maxHeight: 240, overflow: 'auto', mt: 0.5 }}>
                <List dense disablePadding>
                  {results.map((r, i) => (
                    <div key={i}>
                      <ListItem disablePadding>
                        <ListItemButton onClick={() => addMember(SOURCES[source].resultId(r), SOURCES[source].resultLabel(r))}>
                          <PersonListItemText
                            name={SOURCES[source].resultLabel(r)}
                            idLabel={SOURCES[source].idLabel}
                            idValue={SOURCES[source].resultId(r)}
                          />
                        </ListItemButton>
                      </ListItem>
                      {i < results.length - 1 && <Divider />}
                    </div>
                  ))}
                </List>
              </Paper>
            )}
          </Box>
        )}

        {mode === 'id' && (
          // Same Paper + icon + InputBase shape as Search.js's
          // AuthorIdForm, with Teams' own "Add to the working list" button
          // in place of Author's "Open" (which opens a tab immediately).
          <Paper
            component="form"
            onSubmit={e => { e.preventDefault(); if (idInput.trim()) addMember(idInput.trim(), idInput.trim()); }}
            sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: '100%' }}
          >
            <IconButton sx={{ p: '10px' }} aria-label="menu">
              <AccountCircle />
            </IconButton>
            <InputBase
              sx={{ ml: 1, flex: 1 }}
              placeholder={SOURCES[source].idPlaceholder}
              inputProps={{ 'aria-label': SOURCES[source].idLabel }}
              value={idInput}
              onChange={e => setIdInput(e.target.value)}
            />
            <IconButton type="submit" disabled={!idInput.trim()} aria-label="add member">
              <AddIcon fontSize="small" />
            </IconButton>
          </Paper>
        )}

        {mode === 'bulk' && (
          <Box>
            <TextField
              multiline
              minRows={4}
              fullWidth
              size="small"
              placeholder={`One ${SOURCES[source].idLabel} per line`}
              value={bulkInput}
              onChange={e => setBulkInput(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => bulkFileInputRef.current?.click()}>
                Import file
              </Button>
              <input
                ref={bulkFileInputRef}
                type="file"
                accept=".txt"
                hidden
                onChange={handleBulkFileChange}
              />
              <Button size="small" variant="contained" disabled={!bulkInput.trim()} onClick={() => addBulkMembers(bulkInput)}>
                Add all
              </Button>
            </Box>
          </Box>
        )}

        {members.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 4 }}>
            {members.map(m => {
              // A plain id is ambiguous on its own (is "11/1262" a dblp pid
              // or something else?) -- always label it explicitly with its
              // kind, same convention used everywhere else a bare id is
              // shown next to a name (Author.js/AuthorHal.js's own "pid:"/
              // "idHal:" line, Team.js's crosscheck popup, etc.).
              const idLabel = source === 'hal' ? 'idHal' : 'pid';
              return (
                <Chip
                  key={m.id}
                  label={
                    m.label === m.id ? (
                      <span style={{ fontStyle: 'italic', fontSize: '0.85em' }}>{idLabel}: {m.id}</span>
                    ) : (
                      <span style={{ lineHeight: 1.3 }}>
                        {m.label}
                        <br />
                        <span style={{ fontStyle: 'italic', fontSize: '0.85em', color: '#8a8f94' }}>{idLabel}: {m.id}</span>
                      </span>
                    )
                  }
                  onDelete={() => removeMember(m.id)}
                  sx={{ height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal', display: 'block' } }}
                />
              );
            })}
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
          <Button variant="contained" disabled={!canSave} onClick={handleSave}>
            {editingId ? 'Save changes' : 'Save team'}
          </Button>
          {editingId && (
            <Button variant="text" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </Box>
        {members.length === 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Add at least one more member to save a team.
          </Typography>
        )}
      </Box>
    </div>
  );
}
