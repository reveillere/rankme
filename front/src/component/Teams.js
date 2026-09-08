import { useState, useRef } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
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

import { searchAuthor as searchAuthorDblp } from '../dblp';
import { searchAuthor as searchAuthorHal } from '../hal';
import { getTeams, createTeam, updateTeam, deleteTeam } from '../teamStore';

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
  const [source, setSource] = useState('hal');
  const [members, setMembers] = useState([]); // { id, label }
  const [mode, setMode] = useState('name');
  const [query, setQuery] = useState('');
  const [idInput, setIdInput] = useState('');
  const [results, setResults] = useState([]);
  const debounceRef = useRef();

  // Members from one source aren't meaningful once you switch to the other
  // — only clear them on an actual user-driven switch, not when loading an
  // existing team into the form for editing (which also sets source).
  const handleSourceChange = (e, newSource) => {
    setSource(newSource);
    setMembers([]);
    setQuery('');
    setIdInput('');
    setResults([]);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSource('hal');
    setMembers([]);
    setQuery('');
    setIdInput('');
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
        {source === 'dblp' && (
          // Same anti-bot block as Search.js -- dblp.org isn't answering our
          // server's requests right now, so every DBLP member lookup fails.
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: -0.5, mb: 1 }}>
            DBLP is currently unavailable (blocked by their anti-bot protection). Please use HAL for now.
          </Typography>
        )}

        <Typography variant="body2" color="text.secondary" gutterBottom>Add {SOURCES[source].label} members</Typography>

        <ToggleButtonGroup value={mode} exclusive onChange={(e, v) => v && setMode(v)} size="small" sx={{ mb: 1 }}>
          <ToggleButton value="name">By name</ToggleButton>
          <ToggleButton value="id">By {SOURCES[source].idLabel}</ToggleButton>
        </ToggleButtonGroup>

        {mode === 'name' ? (
          <Box sx={{ position: 'relative' }}>
            <TextField
              placeholder="Author name"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              fullWidth
              size="small"
            />
            {results.length > 0 && (
              <Paper sx={{ position: 'absolute', zIndex: 1, width: '100%', maxHeight: 240, overflow: 'auto' }}>
                <List dense>
                  {results.map((r, i) => (
                    <ListItem key={i} disablePadding>
                      <ListItemButton onClick={() => addMember(SOURCES[source].resultId(r), SOURCES[source].resultLabel(r))}>
                        <ListItemText primary={SOURCES[source].resultLabel(r)} secondary={SOURCES[source].resultId(r)} />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              placeholder={SOURCES[source].idPlaceholder}
              value={idInput}
              onChange={e => setIdInput(e.target.value)}
              fullWidth
              size="small"
            />
            <Button variant="outlined" disabled={!idInput.trim()} onClick={() => addMember(idInput.trim(), idInput.trim())}>
              <AddIcon fontSize="small" />
            </Button>
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
