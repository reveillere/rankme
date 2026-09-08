import { useEffect, useRef, useState } from 'react';

import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import HistoryIcon from '@mui/icons-material/History';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import '../App.css';
import { searchStructure } from '../hal';
import { getCachedSearch, setCachedSearch } from '../searchCache';
import { getSearchHistory, removeSearchHistoryByType } from '../searchHistory';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

// A HAL "structure" (lab, institution, team...) search, mirroring the shape
// of Search.js's own by-name/by-id pattern but for a single source (HAL
// structures have no DBLP equivalent) and opening a Structure tab instead
// of an author one.
export default function StructureSearch({ onOpenStructure }) {
  const [mode, setMode] = useState('name'); // 'name' | 'id'
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState([]);
  const [queryStatus, setQueryStatus] = useState('ready');
  const debounceRef = useRef();
  const requestIdRef = useRef(0);

  const runSearch = async (text) => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current++;
      setQueryResult([]);
      setQueryStatus('ready');
      return;
    }

    const requestId = ++requestIdRef.current;
    const cacheKey = `search:hal-structure:${trimmed.toLowerCase()}`;
    const cached = getCachedSearch(cacheKey);
    if (Array.isArray(cached)) {
      setQueryResult(cached);
      setQueryStatus('resolved');
      return;
    }

    setQueryStatus('pending');
    try {
      const data = await searchStructure(encodeURI(trimmed));
      if (requestId !== requestIdRef.current) return;
      if (!Array.isArray(data)) {
        console.error('Unexpected search response', data);
        setQueryResult([]);
        setQueryStatus('error');
        return;
      }
      setQueryResult(data);
      setQueryStatus('resolved');
      setCachedSearch(cacheKey, data);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Search failed', err);
      setQueryResult([]);
      setQueryStatus('error');
    }
  };

  const handleInputChange = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  };

  const handleModeChange = (event, newMode) => {
    if (newMode) setMode(newMode);
  };

  const openStructure = (structId, structureName) => {
    onOpenStructure({
      type: 'hal-structure',
      id: `hal-structure:${structId}`,
      structId,
      structureName,
      label: structureName,
    });
  };

  return (
    <div className='App'>
      <h1>Search a structure on HAL</h1>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}>
        A lab, institution, team, or other organization registered in HAL
        (see <a href="https://aurehal.archives-ouvertes.fr/structure/index" target="_blank" rel="noreferrer">the HAL structure directory</a>).
        Every publication ever affiliated with it is pulled directly, so there&apos;s no member list to maintain.
      </Typography>

      <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange} size="small" style={{ marginBottom: '20px' }}>
        <ToggleButton value="name">By name</ToggleButton>
        <ToggleButton value="id">By HAL structure id</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'name' ? (
        <>
          <StructureSearchForm query={query} onInputChange={handleInputChange} queryResult={queryResult} onOpen={openStructure} />
          {query.trim().length === 0
            ? <RecentStructures onOpenStructure={onOpenStructure} />
            : <StructureSearchResults queryResult={queryResult} queryStatus={queryStatus} onOpen={openStructure} />}
        </>
      ) : (
        <StructureIdForm onOpen={openStructure} />
      )}
    </div>
  );
}

function StructureIdForm({ onOpen }) {
  const [id, setId] = useState('');
  const inputRef = useRef();

  useEffect(() => { inputRef.current.focus(); }, []);

  return (
    <Paper
      component="form"
      onSubmit={e => {
        e.preventDefault();
        const trimmed = id.trim();
        if (!trimmed) return;
        onOpen(trimmed, trimmed);
        setId('');
      }}
      sx={{ p: '2px 4px', display: 'flex', marginBottom: '40px', alignItems: 'center', width: 400, mx: 'auto' }}
    >
      <IconButton sx={{ p: '10px' }} aria-label="menu">
        <AccountBalanceIcon />
      </IconButton>
      <InputBase
        inputRef={inputRef}
        sx={{ ml: 1, flex: 1 }}
        placeholder="e.g. 3102"
        inputProps={{ 'aria-label': 'HAL structure id' }}
        value={id}
        onChange={e => setId(e.target.value)}
      />
      <Button type="submit" disabled={!id.trim()}>Open</Button>
    </Paper>
  );
}

function StructureSearchForm({ query, onInputChange, queryResult, onOpen }) {
  const inputRef = useRef();

  useEffect(() => { inputRef.current.focus(); }, []);

  return (
    <Paper
      component="form"
      onSubmit={e => {
        e.preventDefault();
        if (queryResult && queryResult.length === 1) {
          onOpen(queryResult[0].id, queryResult[0].name);
        }
      }}
      sx={{ p: '2px 4px', display: 'flex', marginBottom: '40px', alignItems: 'center', width: 500, mx: 'auto' }}
    >
      <IconButton sx={{ p: '10px' }} aria-label="menu">
        <AccountBalanceIcon />
      </IconButton>
      <InputBase
        inputRef={inputRef}
        sx={{ ml: 1, flex: 1 }}
        placeholder="Structure name or acronym"
        inputProps={{ 'aria-label': 'Structure name or acronym' }}
        value={query}
        onChange={e => onInputChange(e.target.value)}
      />
    </Paper>
  );
}

function StructureSearchResults({ queryResult, queryStatus, onOpen }) {
  const Results = () => {
    if (queryResult.length !== 0) {
      const listItems = queryResult.map((elt) => (
        <div key={elt.id}>
          <ListItem disablePadding>
            <ListItemButton onClick={() => onOpen(elt.id, elt.name)}>
              <div style={{ minWidth: '500px' }}>
                <ListItemText
                  primary={<span style={{ fontWeight: 'bold' }}>{elt.name}</span>}
                  secondary={
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85em', color: 'gray', display: 'block' }}>
                      {elt.acronym ? `${elt.acronym} — ` : ''}id: {elt.id}
                    </span>
                  }
                />
              </div>
            </ListItemButton>
          </ListItem>
          <Divider />
        </div>
      ));
      return <List>{listItems}</List>;
    }
    return <div>No result!</div>;
  };

  return (
    <div>
      {queryStatus === 'pending' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <IconButton sx={{ p: '10px' }} aria-label="menu">
            <CircularProgress /> Searching...
          </IconButton>
        </Box>
      )}
      {queryStatus === 'resolved' && <Results />}
      {queryStatus === 'error' && <div>Search failed, please try again.</div>}
    </div>
  );
}

function RecentStructures({ onOpenStructure }) {
  // Read fresh on every render rather than once via useState(() => ...):
  // this tab is a PERSISTENT_TABS entry in App.js, mounted once at app load
  // and never unmounted (only display:none/block toggled), so a one-time
  // initializer would permanently show whatever history existed at that
  // very first mount -- typically none -- and never pick up a structure
  // opened afterwards without a full page reload.
  const history = getSearchHistory().filter(e => e.type === 'hal-structure');
  // Only used to force a re-render after clearing (history itself is always
  // read fresh above, so bumping this is enough regardless of its value).
  const [, forceRefresh] = useState(0);

  if (history.length === 0) return null;

  const handleClear = () => {
    removeSearchHistoryByType('hal-structure');
    forceRefresh(t => t + 1);
  };

  return (
    <Box sx={{ width: 500, maxWidth: '100%', margin: '0 auto', textAlign: 'left' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
          <HistoryIcon fontSize="small" />
          <Typography variant="subtitle2">Recent</Typography>
        </Box>
        <Button size="small" startIcon={<DeleteOutlineIcon fontSize="small" />} onClick={handleClear} sx={{ textTransform: 'none' }}>
          Clear
        </Button>
      </Box>
      <List dense disablePadding>
        {history.map((entry) => (
          <ListItem key={entry.id} disablePadding>
            <ListItemButton onClick={() => onOpenStructure(entry)}>
              <ListItemText primary={entry.label} secondary="HAL structure" />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
