import AccountCircle from '@mui/icons-material/AccountCircle';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase'


import { searchAuthor } from './dblp';


function AuthorSearchForm({ setResult, setStatus }) {
    
    const processQuery = async e => {
        e.preventDefault();
        if (e.target.value !== '') {
            setStatus('pending');
            const data = await searchAuthor(encodeURI(e.target.value));
            setResult(data);
            setStatus('resolved');
        }
    }

    
    return (
        <Paper
                component="form"
                onSubmit={e => e.preventDefault()}    
                sx={{ p: '2px 4px', display: 'flex', marginBottom: '40px', alignItems: 'center', width: 400 }}
            >
                <IconButton sx={{ p: '10px' }} aria-label="menu">
                    <AccountCircle />
                </IconButton>
                <InputBase
                    sx={{ ml: 1, flex: 1 }}
                    placeholder="Author name"
                    inputProps={{ 'aria-label': 'Author name' }}
                    onChange={e => processQuery(e)}
                />
        </Paper>
    );
}

export default AuthorSearchForm