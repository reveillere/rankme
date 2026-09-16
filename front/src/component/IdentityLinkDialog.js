import { useEffect, useRef, useState } from 'react';

// Material-UI Components
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Paper from '@mui/material/Paper';
import InputBase from '@mui/material/InputBase';
import IconButton from '@mui/material/IconButton';
import AccountCircle from '@mui/icons-material/AccountCircle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';

import { searchAuthor as searchAuthorHal } from '../hal';
import { searchAuthor as searchAuthorDblp } from '../dblp';
import { PersonListItemText } from './PersonListItemText';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

// The only two things that actually differ between "search HAL for a DBLP
// author's identity" (CrossCheckDialog's original job, Author.js/
// CrossCheckTeam.js's dblp-sourced flow) and "search DBLP for a HAL author's
// identity" (CrossCheckStructure.js's original StructureLinkDialog,
// AuthorHal.js/CrossCheckTeam.js's hal-sourced flow): which endpoint to hit,
// and which field of a result/suggestion object carries its id (`.id` on a
// HAL search hit vs `.pid` on a DBLP one -- see hal.js/dblp.js's own
// searchAuthor). Everything else (debounce, pre-fill-from-suggestion,
// manual-id fallback) was already byte-for-byte identical between the two
// dialogs, so this is the two of them merged into one, parameterized by
// `direction`.
const DIRECTIONS = {
    hal: {
        idLabel: 'idHal',
        placeholder: 'Author name on HAL',
        manualLabel: 'Or enter a HAL idHal directly',
        search: text => searchAuthorHal(encodeURI(text)),
        resultId: elt => elt.id,
        suggestionId: s => s?.idHal,
    },
    dblp: {
        idLabel: 'pid',
        placeholder: 'Author name on DBLP',
        manualLabel: 'Or enter a DBLP pid directly',
        search: text => searchAuthorDblp(encodeURI(text)),
        resultId: elt => elt.pid,
        suggestionId: s => s?.pid,
    },
};

// `suggestion` ({ [idLabel]: id, name?, source? }) is optional and plain
// data -- callers keep passing the exact shape their own report already
// gives them (identityResolution.js's { idHal|pid, name, source } or a
// synthesized { name } when only a member's own name is known -- see
// CrossCheckStructure.js/CrossCheckTeam.js), no reshaping needed on either
// side. There used to also be a `candidates` prop rendering one quick-select
// button per candidate above the search box, but a named suggestion already
// makes the same candidates resurface as ordinary ranked search results (see
// the pre-fill effect below), so the separate buttons were dropped as
// redundant -- one thing to click, not two different-looking ways to pick
// the same person.
export function IdentityLinkDialog({ open, onClose, onConfirm, direction, title, description, suggestion }) {
    const dir = DIRECTIONS[direction];
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [status, setStatus] = useState('ready'); // 'ready' | 'pending' | 'resolved' | 'error'
    const [manualId, setManualId] = useState('');
    const debounceRef = useRef();
    const requestIdRef = useRef(0);

    const runSearch = (text) => {
        const trimmed = text.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            requestIdRef.current++;
            setResults([]);
            setStatus('ready');
            return;
        }
        const requestId = ++requestIdRef.current;
        setStatus('pending');
        dir.search(trimmed).then(data => {
            if (requestId !== requestIdRef.current) return; // a newer search superseded this one
            if (!Array.isArray(data)) {
                setResults([]);
                setStatus('error');
                return;
            }
            setResults(data);
            setStatus('resolved');
        }).catch(() => {
            if (requestId !== requestIdRef.current) return;
            setResults([]);
            setStatus('error');
        });
    };

    // Reset on every open -- this dialog stays mounted (rendered
    // unconditionally so Dialog's own exit transition plays), so a stale
    // query/result set from a previous open must not flash before the user
    // types again. A named suggestion seeds the search box and fires the
    // same search a manual keystroke would, so it surfaces as an ordinary
    // ranked result (first, if HAL/DBLP itself ranks it as the best match)
    // instead of a separate banner a click has to notice and reason about.
    // An id-only suggestion (no name -- e.g. an already-confirmed link whose
    // name was never returned) has nothing to search by, so it seeds the
    // manual-id field instead.
    useEffect(() => {
        if (!open) return;
        setResults([]);
        setStatus('ready');
        if (suggestion?.name) {
            setQuery(suggestion.name);
            setManualId('');
            runSearch(suggestion.name);
        } else {
            const suggestedId = dir.suggestionId(suggestion);
            setQuery('');
            setManualId(suggestedId || '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, suggestion]);

    const handleInputChange = (value) => {
        setQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        const trimmed = manualId.trim();
        if (trimmed) onConfirm(trimmed);
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>
                )}
                <Paper component="form" onSubmit={e => e.preventDefault()} sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', mb: 1 }}>
                    <IconButton sx={{ p: '10px' }} aria-label="menu">
                        <AccountCircle />
                    </IconButton>
                    <InputBase
                        autoFocus
                        sx={{ ml: 1, flex: 1 }}
                        placeholder={dir.placeholder}
                        inputProps={{ 'aria-label': dir.placeholder }}
                        value={query}
                        onChange={e => handleInputChange(e.target.value)}
                    />
                </Paper>
                <Box sx={{ minHeight: 60, maxHeight: 240, overflow: 'auto' }}>
                    {status === 'pending' && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.5 }}>
                            <CircularProgress size={20} />
                            <Typography variant="body2" color="text.secondary">Searching…</Typography>
                        </Box>
                    )}
                    {status === 'resolved' && results.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1.5 }}>No result!</Typography>
                    )}
                    {status === 'resolved' && results.length > 0 && (
                        <List dense disablePadding>
                            {results.map((elt, i) => (
                                <div key={i}>
                                    <ListItem disablePadding>
                                        <ListItemButton onClick={() => onConfirm(dir.resultId(elt))}>
                                            <PersonListItemText name={elt.author} affiliation={elt.affiliation} idLabel={dir.idLabel} idValue={dir.resultId(elt)} />
                                        </ListItemButton>
                                    </ListItem>
                                    {i < results.length - 1 && <Divider />}
                                </div>
                            ))}
                        </List>
                    )}
                    {status === 'error' && (
                        <Typography variant="body2" color="error" sx={{ px: 1, py: 1.5 }}>Search failed, please try again.</Typography>
                    )}
                </Box>
                <Divider sx={{ my: 2 }} />
                <Box component="form" onSubmit={handleManualSubmit} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                        size="small"
                        label={dir.manualLabel}
                        value={manualId}
                        onChange={e => setManualId(e.target.value)}
                        fullWidth
                    />
                    <Button type="submit" disabled={!manualId.trim()}>Use</Button>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
}
