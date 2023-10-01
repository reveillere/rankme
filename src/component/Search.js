import React, { useEffect, useState, useRef } from 'react'; 
import { useNavigate } from 'react-router-dom';

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

// Styles and Other
import '../App.css';

// API Functions
import { searchAuthor } from '../dblp';





export default function AuthorSearch() {
  const [queryResult, setQueryResult] = useState([]);
  const [queryStatus, setQueryStatus] = useState('ready');
  
  return (
    <div className='App'>
      <h1>Search author on DBLP</h1>
      <AuthorSearchForm queryResult={queryResult}  setResult={setQueryResult} setStatus={setQueryStatus} />
      <AuthorSearchResults queryResult={queryResult} queryStatus={queryStatus} />
    </div>
  );
}


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





function AuthorSearchResults({ queryResult, queryStatus }) {
    

  const navigate = useNavigate();
  const gotoPublications = (url) => {
      navigate(`/author/${url}`);
  };

  const Results = () => {
      if (queryResult.length !== 0) {
          const listItems = queryResult.map((elt, i) => (
              <div key={i}>
                  <ListItem disablePadding>
                      <ListItemButton>
                          <div onClick={() => gotoPublications(elt.pid)} style={{ minWidth: '500px', textDecoration: 'none' }}>
                              <ListItemText
                                  primary={<span style={{ fontWeight: 'bold' }}>{elt.author}</span>}
                                  secondary={<span style={{ fontStyle: 'italic' }}>{elt.affiliation}</span>}
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
              <Box style={{ display: 'flex', justifyContent: 'center' }}>
                  <CircularProgress />
              </Box>
          )}
          {queryStatus === 'resolved' && <Results />}
      </div>
  );
}