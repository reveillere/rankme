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

  const openTeam = (team) => {
    onOpenAuthor({ type: 'team', id: `team:${team.id}`, label: team.name, teamId: team.id });
  };

  return (
    <div className="App">
      <h1>Teams</h1>
      <div style={{ fontSize: 'large', marginTop: '-0.8em', marginBottom: '30px', color: 'GrayText' }}>
        Group several DBLP or HAL authors together and rank their merged, deduplicated publications
      </div>

      {teams.length > 0 && (
        <Box sx={{ width: 500, maxWidth: '100%', margin: '0 auto 40px auto', textAlign: 'left' }}>
          <List>
            {teams.map(team => (
              <ListItem
                key={team.id}
                disablePadding
                sx={{ pr: 12 }}
                secondaryAction={
                  <>
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
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
            {members.map(m => (
              <Chip key={m.id} label={m.label} onDelete={() => removeMember(m.id)} />
            ))}
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
