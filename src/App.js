import './App.css'
import React, { useState } from 'react';
import { AppBar, Toolbar, Typography, Button } from '@mui/material';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchAuthor from './component/SearchAuthor';
import { PubList } from './component/PubList';
import PubViz from './component/PubViz';
import Test from './Test';
import About from './About'; // Import the About component

function App() {
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);

  const handleAboutOpen = () => {
    setAboutDialogOpen(true);
  };

  const handleAboutClose = () => {
    setAboutDialogOpen(false);
  };

  return (
    <Router>
      <div>
        <AppBar position="static" style={{ backgroundColor: '#123456' }}>
          <Toolbar>
            <Typography variant="h6" style={{ flexGrow: 1 }}>
              RankeMe
            </Typography>
            <Button color="inherit" component={Link} to="/">Home</Button>
            <Button color="inherit" onClick={handleAboutOpen}>About</Button>
          </Toolbar>
        </AppBar>
        
        <About open={aboutDialogOpen} onClose={handleAboutClose} />
        
        <Routes>
          <Route path="/" element={<SearchAuthor />} />
          <Route path="/publications/*" element={<PubList />} />
          <Route path="/stats/*" element={<PubViz />} />
          <Route path="/test/" element={<Test />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

