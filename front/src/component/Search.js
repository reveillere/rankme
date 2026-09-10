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
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';

// Styles and Other
import '../App.css';

// API Functions
import { searchAuthor as searchAuthorDblp, fetchAuthor as fetchAuthorDblp, fetchStatus as fetchDblpStatus, getName as getDblpName } from '../dblp';
import { searchAuthor as searchAuthorHal } from '../hal';
import { getCachedSearch, setCachedSearch } from '../searchCache';
import { getSearchHistory, removeSearchHistoryByType } from '../searchHistory';
import HistoryIcon from '@mui/icons-material/History';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

const SOURCES = {
    dblp: {
        label: 'DBLP',
        heading: 'Search author on DBLP',
        search: searchAuthorDblp,
        toTab: (elt) => ({ type: 'dblp-author', id: `dblp:${elt.pid}`, label: elt.author, pid: elt.pid, affiliation: elt.affiliation }),
        idLabel: 'PID',
        idPlaceholder: 'e.g. 12/3456',
        idToTab: (pid) => ({ type: 'dblp-author', id: `dblp:${pid}`, label: pid, pid }),
    },
    hal: {
        label: 'HAL',
        heading: 'Search author on HAL',
        search: searchAuthorHal,
        toTab: (elt) => ({ type: 'hal-author', id: `hal:${elt.id}`, label: elt.author, halId: elt.id, authorName: elt.author, affiliation: elt.affiliation }),
        idLabel: 'idHal',
        idPlaceholder: 'e.g. jane-doe',
        idToTab: (id) => ({ type: 'hal-author', id: `hal:${id}`, label: id, halId: id, authorName: undefined }),
    },
};




// searchRequest: optional { source, text } set by a caller (e.g. a HAL
// co-author link with no known idHal) to prefill and immediately run a
// search, switching to the given source if needed.
export default function AuthorSearch({ onOpenAuthor, searchRequest }) {
    // DBLP by default again now that the local dump (see dblp.js's
    // fetchStatus/DblpStatusBanner) is reliably imported -- HAL was the
    // fallback default while DBLP either needed a live dblp.org fetch
    // (blocked by their anti-bot protection) or the local import hadn't
    // run yet.
    const [source, setSource] = useState('dblp');
    const [mode, setMode] = useState('name'); // 'name' | 'id'
    const [query, setQuery] = useState('');
    const [queryResult, setQueryResult] = useState([]);
    const [queryStatus, setQueryStatus] = useState('ready');
    // { ready, importing, version } | null (not fetched yet). DBLP now
    // reads a local dump snapshot instead of dblp.org live -- see
    // dblp.js's fetchStatus -- and that snapshot is dropped and rebuilt in
    // place on every (re)import, so the tab needs to know when it's mid-
    // rebuild rather than just trying and getting empty/wrong results.
    const [dblpStatus, setDblpStatus] = useState(null);
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

    // Polled (not fetch-once) so a rebuild that starts or finishes while
    // this tab is open is reflected without the user having to reload --
    // only while the DBLP tab is actually the one showing, and backed off
    // to a slow interval once we know it's ready (nothing left to change).
    useEffect(() => {
        if (source !== 'dblp') return;
        let cancelled = false;
        const poll = () => fetchDblpStatus().then(s => { if (!cancelled) setDblpStatus(s); }).catch(() => {});
        poll();
        const intervalMs = dblpStatus?.ready ? 30000 : 5000;
        const id = setInterval(poll, intervalMs);
        return () => { cancelled = true; clearInterval(id); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, dblpStatus?.ready]);

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

    const dblpDisabled = source === 'dblp' && !dblpStatus?.ready;

    return (
        <div className='App'>
            <h1>{SOURCES[source].heading}</h1>
            <Tabs
                value={source}
                onChange={handleSourceChange}
                centered
                style={{ marginBottom: '20px' }}
                sx={{ '& .MuiTab-root': { textTransform: 'capitalize' } }}
            >
                {Object.entries(SOURCES).map(([key, { label }]) => (
                    <Tab key={key} value={key} label={label} />
                ))}
            </Tabs>
            {source === 'dblp' && (
                <DblpStatusBanner status={dblpStatus} />
            )}
            <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange} size="small" style={{ marginBottom: '20px' }}>
                <ToggleButton value="name">By name</ToggleButton>
                <ToggleButton value="id">By {SOURCES[source].idLabel}</ToggleButton>
            </ToggleButtonGroup>
            {mode === 'name' ? (
                <>
                    <AuthorSearchForm source={source} query={query} onInputChange={handleInputChange} queryResult={queryResult} onOpenAuthor={onOpenAuthor} disabled={dblpDisabled} />
                    {query.trim().length === 0
                        ? <RecentSearches source={source} onOpenAuthor={onOpenAuthor} />
                        : <AuthorSearchResults source={source} queryResult={queryResult} queryStatus={queryStatus} onOpenAuthor={onOpenAuthor} />}
                </>
            ) : (
                <AuthorIdForm source={source} onOpenAuthor={onOpenAuthor} disabled={dblpDisabled} />
            )}
        </div>
    );
}

// dblp reads a local dump snapshot now (see dblp.js's fetchStatus) instead
// of dblp.org live -- source of truth for the banner text and for
// disabling the search/id forms while a (re)import has the collections it
// reads dropped and being rebuilt (see admin.js's processXML).
function DblpStatusBanner({ status }) {
    if (!status || status.importing) {
        return (
            <Alert severity="info" sx={{ width: 500, maxWidth: '100%', margin: '0 auto 20px' }}>
                DBLP local dump import in progress -- search and lookup are disabled until it finishes.
            </Alert>
        );
    }
    if (!status.ready) {
        return (
            <Alert severity="warning" sx={{ width: 500, maxWidth: '100%', margin: '0 auto 20px' }}>
                DBLP hasn't been imported locally yet. Please use HAL for now.
            </Alert>
        );
    }
    const importedDate = status.importedAt
        ? new Date(status.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
    return (
        <Alert severity="success" sx={{ width: 500, maxWidth: '100%', margin: '0 auto 20px' }}>
            DBLP results come from a local snapshot of the dblp.org dump{importedDate ? ` (imported ${importedDate})` : ''}, not a live query --
            dblp.org itself is currently blocked by their anti-bot protection. Matching is by exact
            author name, so accuracy depends on dblp's own name disambiguation.
        </Alert>
    );
}


function AuthorIdForm({ source, onOpenAuthor, disabled }) {
    const [id, setId] = useState('');
    // DBLP only (see the preview effect below): undefined = not looked up
    // yet/empty id, null = looked up, no local record, string = the name
    // found for this PID. Shown before the user commits to opening the
    // tab, since a PID is opaque on its own -- easy to fat-finger a digit
    // and land on a different person's page without noticing.
    const [previewName, setPreviewName] = useState(undefined);
    const inputRef = useRef();
    const previewDebounceRef = useRef();
    const previewRequestIdRef = useRef(0);

    // Switching source (DBLP <-> HAL) means a stale id from the other
    // source is no longer meaningful — drop it rather than leave it
    // sitting there ready to be submitted against the wrong source.
    useEffect(() => {
        setId('');
        setPreviewName(undefined);
        inputRef.current.focus();
    }, [source]);

    useEffect(() => {
        if (source !== 'dblp') return;
        if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
        const trimmed = id.trim();
        if (!trimmed) {
            previewRequestIdRef.current++;
            setPreviewName(undefined);
            return;
        }
        const requestId = ++previewRequestIdRef.current;
        previewDebounceRef.current = setTimeout(async () => {
            try {
                const author = await fetchAuthorDblp(trimmed);
                if (requestId !== previewRequestIdRef.current) return;
                setPreviewName(getDblpName(author) || null);
            } catch {
                if (requestId !== previewRequestIdRef.current) return;
                setPreviewName(null);
            }
        }, DEBOUNCE_MS);
    }, [source, id]);

    const showPreview = source === 'dblp' && id.trim().length > 0;

    return (
        <>
            <Paper
                component="form"
                onSubmit={e => {
                    e.preventDefault();
                    const trimmed = id.trim();
                    if (!trimmed) return;
                    onOpenAuthor(SOURCES[source].idToTab(trimmed));
                    setId('');
                }}
                sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: 400 }}
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
                    disabled={disabled}
                    onChange={e => setId(e.target.value)}
                />
                <Button type="submit" disabled={disabled || !id.trim() || (showPreview && previewName === null)}>Open</Button>
            </Paper>
            {showPreview && (
                <Typography variant="body2" sx={{ mt: 1, mb: 3, color: previewName === null ? 'error.main' : 'text.secondary' }}>
                    {previewName === undefined ? 'Looking up…' : previewName === null ? 'No local DBLP record for this PID.' : `→ ${previewName}`}
                </Typography>
            )}
            {!showPreview && <Box sx={{ mb: 5 }} />}
        </>
    );
}


function AuthorSearchForm({ source, query, onInputChange, queryResult, onOpenAuthor, disabled }) {

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
                disabled={disabled}
                onChange={e => onInputChange(e.target.value)}
            />
        </Paper>
    );
}





// Shared row content for a person (author) entry, used by both the live
// search results below and RecentSearches, so a name looks the same
// whether it came from a fresh query or from history.
function PersonListItemText({ name, affiliation, idLabel, idValue }) {
    return (
        <ListItemText
            primary={<span style={{ fontWeight: 'bold' }}>{name}</span>}
            secondary={
                <>
                    {(affiliation || []).map((affil, index) => (
                        <span key={index} style={{ fontStyle: 'italic', display: 'block' }}>
                            {affil}
                        </span>
                    ))}
                    {idValue && (
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85em', color: 'gray', display: 'block' }}>
                            {idLabel}: {idValue}
                        </span>
                    )}
                </>
            }
        />
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
                                <PersonListItemText
                                    name={elt.author}
                                    affiliation={elt.affiliation}
                                    idLabel={SOURCES[source].idLabel}
                                    idValue={source === 'dblp' ? elt.pid : elt.id}
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


// Maps the current search tab (SOURCES key) to the single history entry
// type it should recall -- e.g. switching to the DBLP tab shows only
// past DBLP author lookups, not HAL ones (or teams, which have their own
// full browsable list on the Teams tab and so don't need recalling here).
const HISTORY_TYPE_FOR_SOURCE = {
    dblp: 'dblp-author',
    hal: 'hal-author',
};

function RecentSearches({ source, onOpenAuthor }) {
    const historyType = HISTORY_TYPE_FOR_SOURCE[source];

    // Read fresh on every render rather than once via useState(() => ...):
    // the Author tab is a PERSISTENT_TABS entry in App.js, mounted once at
    // app load and never unmounted (only display:none/block toggled), so a
    // one-time initializer would permanently show whatever history existed
    // at that very first mount and never pick up an author opened
    // afterwards without a full page reload.
    const history = getSearchHistory().filter(e => e.type === historyType);
    // Only used to force a re-render after clearing (history itself is
    // always read fresh above, so bumping this is enough regardless of its
    // value).
    const [, forceRefresh] = useState(0);

    if (history.length === 0) return null;

    const handleClear = () => {
        removeSearchHistoryByType(historyType);
        forceRefresh(t => t + 1);
    };

    return (
        <Box sx={{ width: 500, maxWidth: '100%', margin: '0 auto', textAlign: 'left' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                    <HistoryIcon fontSize="small" />
                    <Typography variant="subtitle2">Recent on {SOURCES[source].label}</Typography>
                </Box>
                <Button size="small" startIcon={<DeleteOutlineIcon fontSize="small" />} onClick={handleClear} sx={{ textTransform: 'none' }}>
                    Clear
                </Button>
            </Box>
            <List dense disablePadding>
                {history.map((entry) => (
                    <div key={entry.id}>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => onOpenAuthor(entry)}>
                                <PersonListItemText
                                    name={entry.label}
                                    affiliation={entry.affiliation}
                                    idLabel={SOURCES[source].idLabel}
                                    idValue={entry.pid || entry.halId}
                                />
                            </ListItemButton>
                        </ListItem>
                        <Divider />
                    </div>
                ))}
            </List>
        </Box>
    );
}
