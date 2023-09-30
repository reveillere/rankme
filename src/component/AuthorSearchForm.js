import AccountCircle from '@mui/icons-material/AccountCircle';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase'
import { useNavigate } from 'react-router-dom';
import React, { useEffect, useRef } from 'react'; 


import { searchAuthor } from '../dblp';


function AuthorSearchForm({ queryResult, setResult, setStatus }) {

    const inputRef = useRef(); 

    useEffect(() => {
        inputRef.current.focus(); 
    }, []); 


    const processQuery = async e => {
        e.preventDefault();
        if (e.target.value !== '') {
            setStatus('pending');
            const data = await searchAuthor(encodeURI(e.target.value));
            setResult(data);
            setStatus('resolved');
        }
    }

    const navigate = useNavigate();

    return (
        <Paper
            component="form"
            onSubmit={e => {
                e.preventDefault();
                if (queryResult && queryResult.length === 1) {
                    const pid = queryResult[0].pid;
                    navigate(`/author/${pid}`);
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
                onChange={e => processQuery(e)}
            />
        </Paper>
    );
}

export default AuthorSearchForm