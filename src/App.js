import './App.css'
import React, { useState, useEffect } from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Menu, MenuItem, IconButton } from '@mui/material';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchAuthor from './component/SearchAuthor';
import { PubList } from './component/PubList';
import PubViz from './component/PubViz';
import Test from './Test';
import About from './About'; // Import the About component
import './utils.js';
import SettingsIcon from '@mui/icons-material/Settings';

function App() {
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleAboutOpen = () => {
    setAboutDialogOpen(true);
  };

  const handleAboutClose = () => {
    setAboutDialogOpen(false);
  };

  return (
    <Router>
      <div>
        <AppBar position="static" style={{ backgroundColor: '#123456', height: '64px' }}>
          <Toolbar style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Box display="flex" alignItems="center">
              <Typography variant="h6">
                RankMe
              </Typography>
              <Button color="inherit" component={Link} to="/">Home</Button>
              <IconButton color="inherit" onClick={handleMenuOpen}>
                <SettingsIcon />
              </IconButton>
            </Box>
            <Button color="inherit" onClick={handleAboutOpen}>About</Button>
          </Toolbar>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
          >
            <MenuItem onClick={() => {
              localStorage.clear(); 
              handleMenuClose();
            }}>Clear Cache</MenuItem>
          </Menu>
        </AppBar>

        <About open={aboutDialogOpen} onClose={handleAboutClose} />

        <Routes>
          <Route path="/" element={<SearchAuthor />} />
          <Route path="/author/*" element={<PubViz />} />
          
          <Route path="/publications/*" element={<PubList />} />
          <Route path="/test/" element={<Test />} />
        </Routes>
      </div>
    </Router>

  );
}

export default App;

