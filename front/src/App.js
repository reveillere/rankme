import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

// Material-UI Components and Icons
import { AppBar, Toolbar, Typography, Button, Box, Menu, MenuItem, IconButton } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SearchIcon from '@mui/icons-material/Search';
import CircularProgress from '@mui/material/CircularProgress';

// Custom Components
import AuthorSearch from './component/Search';
import { Author } from './component/Author';
import About from './component/About'; 

// Styles and Other
import './App.css';
import './utils.js';





function App() {
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);

  const handleAboutOpen = () => {
    setAboutDialogOpen(true);
  };

  const handleAboutClose = () => {
    setAboutDialogOpen(false);
  };

  return (
    <Router basename='/'>
      <div>
        <AppBar position="static" style={{ backgroundColor: '#123456', height: '64px' }}>
          <Toolbar style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Box display="flex" alignItems="center">
              <Typography variant="h6">
                RankMe
              </Typography>
              <Button color="inherit" component={Link} to="/">      <SearchIcon />
              </Button>
            </Box>
            <Button color="inherit" onClick={handleAboutOpen}>About</Button>
          </Toolbar>
        </AppBar>

        <About open={aboutDialogOpen} onClose={handleAboutClose} />


        <Routes>
          <Route path="/" element={<AuthorSearch />} />
          <Route path="/author/*" element={<Author />} />
        </Routes>
      </div>
    </Router>

  );
}

export default App;

