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
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Chip from '@mui/material/Chip';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import AccountCircle from '@mui/icons-material/AccountCircle';

import { searchAuthor as searchAuthorDblp } from '../dblp';
import { searchAuthor as searchAuthorHal } from '../hal';
import { getTeams, createTeam, updateTeam, deleteTeam } from '../teamStore';
import { PersonListItemText } from './PersonListItemText';
import { MemberList } from './MemberListDialog';
import { ExportButton } from './ExportButton';
import { ImportButton } from './ImportButton';
import { HelpButton } from './HelpButton';
import { downloadTextFile } from '../exportPublications';
import { apiTokenHeaders } from '../apiToken';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;
const parseCsv = (text) => String(text).trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
  const cells = [];
  line.replace(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g, (_, quoted, plain) => {
    cells.push((quoted ?? plain).replaceAll('""', '"'));
    return '';
  });
  return cells;
});

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
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating a new team
  const [creationSetup, setCreationSetup] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [name, setName] = useState('');
  // DBLP by default -- see the identical note in Search.js: HAL was only
  // ever the fallback while DBLP needed a live dblp.org fetch (blocked by
  // their anti-bot protection) or the local dump hadn't been imported yet.
  const [source, setSource] = useState('');
  const [members, setMembers] = useState([]); // { id, label }
  const [mode, setMode] = useState('name');
  const [query, setQuery] = useState('');
  const [idInput, setIdInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [results, setResults] = useState([]);
  const [memberValidationError, setMemberValidationError] = useState('');
  const [validatingMembers, setValidatingMembers] = useState(false);
  const debounceRef = useRef();
  const membersJsonInputRef = useRef();
  const membersCsvInputRef = useRef();
  const membersTxtInputRef = useRef();
  const teamsJsonInputRef = useRef();
  const teamsCsvInputRef = useRef();

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
    setMemberValidationError('');
  };

  const resetForm = () => {
    setEditingId(null);
    setCreationSetup(false);
    setName('');
    setSource('');
    setMembers([]);
    setQuery('');
    setIdInput('');
    setBulkInput('');
    setResults([]);
    setMemberValidationError('');
  };

  const startEdit = (team) => {
    setEditingId(team.id);
    setCreationSetup(false);
    setName(team.name);
    setSource(team.source);
    setMembers(team.members);
    setMode('name');
    setQuery('');
    setIdInput('');
    setBulkInput('');
    setResults([]);
    setMemberValidationError('');
    setFormOpen(true);
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

  // Manual ids have not come from the source search result, so resolve every
  // one before it reaches the working team. This also supplies the canonical
  // name instead of treating an arbitrary typed label as authoritative.
  const validateAndAddMembers = async (ids) => {
    const uniqueIds = Array.from(new Set(ids.map(id => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0 || validatingMembers) return;
    setValidatingMembers(true);
    setMemberValidationError('');
    const checked = await Promise.all(uniqueIds.map(async id => {
      try {
        const endpoint = source === 'dblp' ? `/api/dblp/author/${encodeURIComponent(id)}` : `/api/hal/author-info/${encodeURIComponent(id)}`;
        const response = await fetch(endpoint, { headers: apiTokenHeaders() });
        if (!response.ok) return null;
        const data = await response.json();
        const label = source === 'dblp' ? data?.dblpperson?.$?.name : data?.name;
        return label ? { id, label } : null;
      } catch {
        return null;
      }
    }));
    const valid = checked.filter(Boolean);
    const invalid = uniqueIds.filter((_, index) => !checked[index]);
    setMembers(prev => [...prev, ...valid.filter(member => !prev.some(existing => existing.id === member.id))]);
    if (invalid.length) setMemberValidationError(`Unknown ${SOURCES[source].idLabel}${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
    setIdInput('');
    setBulkInput('');
    setValidatingMembers(false);
  };

  // One id per line, but also tolerate commas/semicolons since a pasted
  // list won't always be newline-separated.
  const addBulkMembers = (text) => {
    const ids = Array.from(new Set(text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)));
    validateAndAddMembers(ids);
  };

  const normalizedName = name.trim().toLocaleLowerCase();
  const teamNameExists = normalizedName && teams.some(team => team.id !== editingId && team.name.trim().toLocaleLowerCase() === normalizedName);
  const canStartCreation = name.trim().length > 0 && !!source && !teamNameExists;
  const canSave = canStartCreation && members.length >= 2;

  const handleSave = () => {
    if (!canSave) return;
    if (editingId) {
      updateTeam(editingId, { name: name.trim(), source, members });
    } else {
      createTeam(name.trim(), source, members);
    }
    setTeams(getTeams());
    resetForm();
    setFormOpen(false);
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
  const handleExportTeamsJson = () => {
    const exportData = teams.map(team => ({ name: team.name, source: team.source, members: team.members.map(member => ({ id: member.id })) }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankme-teams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleExportTeamsMarkdown = () => downloadTextFile('rankme-teams.md', `# Teams\n\n${teams.map(team => `## ${team.name}\n\nSource: ${team.source.toUpperCase()}\n\n${team.members.map(member => `- ${member.label || member.id} (${team.source === 'hal' ? 'idHal' : 'pid'}: ${member.id})`).join('\n')}`).join('\n\n')}\n`, 'text/markdown;charset=utf-8;');
  const handleExportTeamsCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = teams.flatMap(team => team.members.map(member => [team.name, team.source, member.id].map(quote).join(',')));
    downloadTextFile('rankme-teams.csv', ['team,source,id', ...rows].join('\n'), 'text/csv;charset=utf-8;');
  };
  const handleExportMembersJson = () => downloadTextFile('rankme-team-members.json', JSON.stringify(members, null, 2), 'application/json;charset=utf-8;');
  const handleExportMembersMarkdown = () => downloadTextFile('rankme-team-members.md', `# Members\n\n${members.map(member => `- ${member.label || member.id} (${source === 'hal' ? 'idHal' : 'pid'}: ${member.id})`).join('\n')}\n`, 'text/markdown;charset=utf-8;');
  const handleExportMembersCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    downloadTextFile('rankme-team-members.csv', ['id', ...members.map(member => quote(member.id)).join('\n')].join('\n'), 'text/csv;charset=utf-8;');
  };
  const handleImportMembersFile = (e, format) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (format === 'txt') {
          addBulkMembers(String(reader.result));
          return;
        }
        const data = format === 'csv' ? parseCsv(reader.result).map(([id]) => ({ id })) : JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : [];
        validateAndAddMembers(list.filter(m => m?.id).map(m => String(m.id)));
      } catch { /* invalid member file */ }
    };
    reader.readAsText(file);
  };

  // Imported teams are created afresh so their local ids cannot collide.
  // A duplicate name, however, is skipped: names are the meaningful team
  // identity in this UI and keeping both would make the list ambiguous.
  const handleImportTeamsFile = (e, format) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        if (format === 'csv') {
          const grouped = new Map();
          parseCsv(reader.result).forEach(([team, source, id]) => {
            if (!team || !id || (source !== 'dblp' && source !== 'hal')) return;
            const key = `${source}\u0000${team}`;
            const entry = grouped.get(key) || { name: team, source, members: [] };
            entry.members.push({ id, label: id });
            grouped.set(key, entry);
          });
          parsed = [...grouped.values()];
        } else {
          parsed = JSON.parse(String(reader.result));
        }
      } catch {
        return;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const knownNames = new Set(getTeams().map(team => team.name.trim().toLocaleLowerCase()));
      const duplicates = [];
      for (const t of list) {
        if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
        if (t.source !== 'dblp' && t.source !== 'hal') continue;
        if (!Array.isArray(t.members) || t.members.length === 0) continue;
        const importedName = t.name.trim();
        const normalizedImportedName = importedName.toLocaleLowerCase();
        if (knownNames.has(normalizedImportedName)) {
          duplicates.push(importedName);
          continue;
        }
        createTeam(importedName, t.source, t.members.map(member => ({ id: String(member.id), label: String(member.id) })));
        knownNames.add(normalizedImportedName);
      }
      setTeams(getTeams());
      setImportMessage(duplicates.length ? `${duplicates.join(', ')} ${duplicates.length === 1 ? 'was' : 'were'} not imported because a team with that name already exists.` : '');
    };
    reader.readAsText(file);
  };

  const openTeam = (team) => {
    onOpenAuthor({ type: 'team', id: `team:${team.id}`, label: team.name, teamId: team.id });
  };

  return (
    <div className="App">
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}><h1>Teams</h1><HelpButton title="Teams help" sections={[{ title: 'Create a team', description: 'A team needs a unique name and exactly one source: HAL or DBLP. The source cannot change later.' }, { title: 'Add members', description: 'Names come from source search. Typed ids, bulk ids and TXT files are checked against HAL or DBLP before they are added.' }, { title: 'Import teams: JSON', description: 'Import a JSON file with each team name, source and member identifiers.', example: '[{\n  "name": "My team",\n  "source": "dblp",\n  "members": [{ "id": "11/1262" }]\n}]' }, { title: 'Import teams: CSV', description: 'Import a CSV with each team name, source and member identifiers.', example: 'team,source,id\nMy team,dblp,11/1262' }, { title: 'Import members: TXT', description: 'TXT imports one identifier per line into the team currently being edited. A DBLP team accepts only PIDs; a HAL team accepts only idHals. Each identifier is checked before it is added.', example: '11/1262\n12/3456' }, { title: 'Import members', description: 'Members also accept JSON or CSV exports. A team with an existing name is skipped during import.' }]} /><ExportButton onExportMarkdown={handleExportTeamsMarkdown} onExportJson={handleExportTeamsJson} onExportCsv={handleExportTeamsCsv} disabled={teams.length === 0} /><ImportButton title="Import teams" onImportJson={() => teamsJsonInputRef.current?.click()} onImportCsv={() => teamsCsvInputRef.current?.click()} /></Box>
      <div style={{ fontSize: 'large', marginTop: '-0.8em', marginBottom: '10px', color: 'GrayText' }}>
        Group several DBLP or HAL authors together and rank their merged, deduplicated publications
      </div>

      <input ref={teamsJsonInputRef} type="file" accept=".json,application/json" hidden onChange={e => handleImportTeamsFile(e, 'json')} />
      <input ref={teamsCsvInputRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleImportTeamsFile(e, 'csv')} />

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
                    secondary={<Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}><span>{team.members.length} members</span><Chip label={SOURCES[team.source]?.label || team.source} size="small" sx={{ bgcolor: 'grey.100', color: 'text.secondary' }} /></Box>}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Divider sx={{ mt: 3 }} />
        </Box>
      )}

      <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreationSetup(true); setFormOpen(true); }} sx={{ display: 'block', mx: 'auto', mb: 2, textTransform: 'none' }}>New team</Button>
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><span>{editingId ? 'Edit team' : 'New team'}</span>{source && <Chip label={SOURCES[source]?.label} size="small" sx={{ bgcolor: 'grey.100', color: 'text.secondary' }} />}</Box><Box sx={{ display: 'flex', gap: 0.5 }}><ExportButton onExportMarkdown={handleExportMembersMarkdown} onExportJson={handleExportMembersJson} onExportCsv={handleExportMembersCsv} disabled={members.length === 0} /><ImportButton title="Import members" onImportJson={() => membersJsonInputRef.current?.click()} onImportCsv={() => membersCsvInputRef.current?.click()} onImportTxt={() => membersTxtInputRef.current?.click()} /><input ref={membersJsonInputRef} type="file" accept=".json,application/json" hidden onChange={e => handleImportMembersFile(e, 'json')} /><input ref={membersCsvInputRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleImportMembersFile(e, 'csv')} /><input ref={membersTxtInputRef} type="file" accept=".txt,text/plain" hidden onChange={e => handleImportMembersFile(e, 'txt')} /></Box></DialogTitle>
      <DialogContent dividers>
      <Box sx={{ textAlign: 'left' }}>
        <Box component="section">
          <Typography variant="subtitle2" gutterBottom>Name</Typography>
          <TextField
            label="Team name"
            required
            error={!!teamNameExists}
            helperText={teamNameExists ? 'A team with this name already exists.' : ''}
            value={name}
            onChange={e => setName(e.target.value)}
            fullWidth
            size="small"
          />
          {editingId ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              The source cannot be changed after the team is created.
            </Typography>
          ) : creationSetup && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Source *</Typography>
              <Tabs
                value={source}
                onChange={handleSourceChange}
                sx={{ mt: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
              >
                {Object.entries(SOURCES).map(([key, { label }]) => <Tab key={key} value={key} label={<Chip label={label} size="small" color="primary" variant="outlined" />} sx={{ minWidth: 88 }} />)}
              </Tabs>
              {!source && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>Choose DBLP or HAL before adding members.</Typography>}
              <Button variant="contained" size="small" disabled={!canStartCreation} onClick={() => setCreationSetup(false)} sx={{ mt: 2 }}>Continue</Button>
            </>
          )}
        </Box>

        {source && !creationSetup && <><Box component="section" sx={{ mt: 3 }}><Typography variant="subtitle2" gutterBottom>Add {SOURCES[source].label} members</Typography>

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
            onSubmit={e => { e.preventDefault(); validateAndAddMembers([idInput]); }}
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
            <IconButton type="submit" disabled={!idInput.trim() || validatingMembers} aria-label="add member">
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
              <Button size="small" variant="contained" disabled={!bulkInput.trim() || validatingMembers} onClick={() => addBulkMembers(bulkInput)}>
                {validatingMembers ? 'Checking…' : 'Add all'}
              </Button>
            </Box>
          </Box>
        )}

        </Box>

        {memberValidationError && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setMemberValidationError('')}>{memberValidationError}</Alert>}

        <Box component="section" sx={{ mt: 3 }}>
          <Typography variant="subtitle2" gutterBottom>Members ({members.length})</Typography>
          {members.length > 0 && <MemberList members={members.map(member => ({ ...member, idKind: source === 'hal' ? 'idHal' : 'pid' }))} onDelete={removeMember} />}
          {members.length === 0 && <Typography variant="body2" color="text.secondary">No members yet.</Typography>}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
          <Button variant="contained" disabled={!canSave} onClick={handleSave}>
            {editingId ? 'Save changes' : 'Save team'}
          </Button>
          {editingId && (
            <Button variant="text" onClick={() => { resetForm(); setFormOpen(false); }}>
              Cancel
            </Button>
          )}
        </Box>
        {members.length === 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Add at least one more member to save a team.
          </Typography>
        )}
        </>}
      </Box>
      </DialogContent>
      {!editingId && <DialogActions><Button onClick={() => setFormOpen(false)}>Close</Button></DialogActions>}
      </Dialog>
      <Snackbar open={!!importMessage} autoHideDuration={6000} onClose={() => setImportMessage('')}><Alert severity="error" onClose={() => setImportMessage('')}>{importMessage}</Alert></Snackbar>
    </div>
  );
}
