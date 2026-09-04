import { useEffect, useState, useRef } from 'react';

// Material-UI Components and Icons
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import AccountCircle from '@mui/icons-material/AccountCircle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';

// Styles and Other
import '../App.css';

// API Functions
import { searchAuthor as searchAuthorDblp } from '../dblp';
import { searchAuthor as searchAuthorHal } from '../hal';
import { getCachedSearch, setCachedSearch } from '../searchCache';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

const SOURCES = {
    dblp: {
        label: 'DBLP',
        heading: 'Search author on DBLP',
        search: searchAuthorDblp,
        toTab: (elt) => ({ type: 'dblp-author', id: `dblp:${elt.pid}`, label: elt.author, pid: elt.pid }),
        idLabel: 'PID',
        idPlaceholder: 'e.g. 12/3456',
        idToTab: (pid) => ({ type: 'dblp-author', id: `dblp:${pid}`, label: pid, pid }),
    },
    hal: {
        label: 'HAL',
        heading: 'Search author on HAL',
        search: searchAuthorHal,
        toTab: (elt) => ({ type: 'hal-author', id: `hal:${elt.id}`, label: elt.author, halId: elt.id, authorName: elt.author }),
        idLabel: 'idHal',
        idPlaceholder: 'e.g. jane-doe',
        idToTab: (id) => ({ type: 'hal-author', id: `hal:${id}`, label: id, halId: id, authorName: undefined }),
    },
};




// searchRequest: optional { source, text } set by a caller (e.g. a HAL
// co-author link with no known idHal) to prefill and immediately run a
// search, switching to the given source if needed.
export default function AuthorSearch({ onOpenAuthor, searchRequest }) {
    const [source, setSource] = useState('dblp');
    const [mode, setMode] = useState('name'); // 'name' | 'id'
    const [query, setQuery] = useState('');
    const [queryResult, setQueryResult] = useState([]);
    const [queryStatus, setQueryStatus] = useState('ready');
    const debounceRef = useRef();
    const requestIdRef = useRef(0);

    const runSearch = async (src, text) => {
        const trimmed = text.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            requestIdRef.current++;
            setQueryResult([]);
            setQueryStatus('ready');
            return;
        }

        const requestId = ++requestIdRef.current;
        const cacheKey = `search:${src}:${trimmed.toLowerCase()}`;
        const cached = getCachedSearch(cacheKey);
        if (Array.isArray(cached)) {
            setQueryResult(cached);
            setQueryStatus('resolved');
            return;
        }

        setQueryStatus('pending');
        try {
            const data = await SOURCES[src].search(encodeURI(trimmed));
            if (requestId !== requestIdRef.current) return; // a newer search superseded this one
            if (!Array.isArray(data)) {
                // The API returned an error payload (e.g. { error: ... }) rather
                // than results — never cache or render that as a result list.
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

    useEffect(() => {
        if (!searchRequest) return;
        setSource(searchRequest.source);
        setMode('name');
        setQuery(searchRequest.text);
        runSearch(searchRequest.source, searchRequest.text);
    }, [searchRequest]);

    const handleSourceChange = (event, newSource) => {
        setSource(newSource);
        if (mode === 'name') runSearch(newSource, query);
    };

    const handleModeChange = (event, newMode) => {
        if (newMode) setMode(newMode);
    };

    const handleInputChange = (value) => {
        setQuery(value);

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            runSearch(source, value);
        }, DEBOUNCE_MS);
    };

    return (
        <div className='App'>
            <h1>{SOURCES[source].heading}</h1>
            <Tabs value={source} onChange={handleSourceChange} centered style={{ marginBottom: '20px' }}>
                {Object.entries(SOURCES).map(([key, { label }]) => (
                    <Tab key={key} value={key} label={label} />
                ))}
            </Tabs>
            <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange} size="small" style={{ marginBottom: '20px' }}>
                <ToggleButton value="name">By name</ToggleButton>
                <ToggleButton value="id">By {SOURCES[source].idLabel}</ToggleButton>
            </ToggleButtonGroup>
            {mode === 'name' ? (
                <>
                    <AuthorSearchForm source={source} query={query} onInputChange={handleInputChange} queryResult={queryResult} onOpenAuthor={onOpenAuthor} />
                    <AuthorSearchResults source={source} queryResult={queryResult} queryStatus={queryStatus} onOpenAuthor={onOpenAuthor} />
                </>
            ) : (
                <AuthorIdForm source={source} onOpenAuthor={onOpenAuthor} />
            )}
        </div>
    );
}


function AuthorIdForm({ source, onOpenAuthor }) {
    const [id, setId] = useState('');
    const inputRef = useRef();

    // Switching source (DBLP <-> HAL) means a stale id from the other
    // source is no longer meaningful — drop it rather than leave it
    // sitting there ready to be submitted against the wrong source.
    useEffect(() => {
        setId('');
        inputRef.current.focus();
    }, [source]);

    return (
        <Paper
            component="form"
            onSubmit={e => {
                e.preventDefault();
                const trimmed = id.trim();
                if (!trimmed) return;
                onOpenAuthor(SOURCES[source].idToTab(trimmed));
                setId('');
            }}
            sx={{ p: '2px 4px', display: 'flex', marginBottom: '40px', alignItems: 'center', width: 400 }}
        >
            <IconButton sx={{ p: '10px' }} aria-label="menu">
                <AccountCircle />
            </IconButton>
            <InputBase
                inputRef={inputRef}
                sx={{ ml: 1, flex: 1 }}
                placeholder={SOURCES[source].idPlaceholder}
                inputProps={{ 'aria-label': `${SOURCES[source].idLabel} (${source})` }}
                value={id}
                onChange={e => setId(e.target.value)}
            />
            <Button type="submit" disabled={!id.trim()}>Open</Button>
        </Paper>
    );
}


function AuthorSearchForm({ source, query, onInputChange, queryResult, onOpenAuthor }) {

    const inputRef = useRef();

    useEffect(() => {
        inputRef.current.focus();
    }, []);

    return (
        <Paper
            component="form"
            onSubmit={e => {
                e.preventDefault();
                if (queryResult && queryResult.length === 1) {
                    onOpenAuthor(SOURCES[source].toTab(queryResult[0]));
                }
            }}
            sx={{ p: '2px 4px', display: 'flex', marginBottom: '40px', alignItems: 'center', width: 400 }}
        >
            <IconButton sx={{ p: '10px' }} aria-label="menu">
                <AccountCircle />
            </IconButton>
            <InputBase
                inputRef={inputRef}
                sx={{ ml: 1, flex: 1 }}
                placeholder="Author name"
                inputProps={{ 'aria-label': 'Author name' }}
                value={query}
                onChange={e => onInputChange(e.target.value)}
            />
        </Paper>
    );
}





function AuthorSearchResults({ source, queryResult, queryStatus, onOpenAuthor }) {

    const Results = () => {
        if (queryResult.length !== 0) {
            const listItems = queryResult.map((elt, i) => (
                <div key={i}>
                    <ListItem disablePadding>
                        <ListItemButton onClick={() => onOpenAuthor(SOURCES[source].toTab(elt))}>
                            <div style={{ minWidth: '500px' }}>
                                <ListItemText
                                    primary={<span style={{ fontWeight: 'bold' }}>{elt.author}</span>}
                                    secondary={
                                        <>
                                            {elt.affiliation.map((affil, index) => (
                                                <span key={index} style={{ fontStyle: 'italic', display: 'block' }}>
                                                    {affil}
                                                </span>
                                            ))}
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.85em', color: 'gray', display: 'block' }}>
                                                {SOURCES[source].idLabel}: {source === 'dblp' ? elt.pid : elt.id}
                                            </span>
                                        </>
                                    }
                                />
                            </div>
                        </ListItemButton>
                    </ListItem>
                    <Divider />
                </div>
            ));

            return <List>{listItems}</List>;
        } else return <div>No result!</div>;
    };


    return (
        <div>
            {queryStatus === 'pending' && (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100vh', // Viewport Height
                    }}
                >
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
