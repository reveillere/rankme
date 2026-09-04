import { useState } from 'react';

// Material-UI Components and Icons
import { AppBar, Toolbar, Typography, Button, Box, Tabs, Tab } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

// Custom Components
import AuthorSearch from './component/Search';
import { Author } from './component/Author';
import { AuthorHal } from './component/AuthorHal';
import About from './component/About';

// Styles and Other
import './App.css';
import './utils.js';


const SEARCH_TAB_ID = 'search';

function App() {
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [tabs, setTabs] = useState([{ id: SEARCH_TAB_ID, type: 'search' }]);
  const [activeTabId, setActiveTabId] = useState(SEARCH_TAB_ID);
  const [searchRequest, setSearchRequest] = useState(null);

  const handleAboutOpen = () => setAboutDialogOpen(true);
  const handleAboutClose = () => setAboutDialogOpen(false);

  const openAuthorTab = (tab) => {
    setTabs(prev => (prev.some(t => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
  };

  // Used when a co-author has no known id on the target source: switch to
  // the Search tab, prefill and immediately run a search for their name.
  const searchAuthorByName = (source, text) => {
    setSearchRequest({ source, text });
    setActiveTabId(SEARCH_TAB_ID);
  };

  const closeTab = (id) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId((next[idx - 1] || next[0]).id);
      }
      return next;
    });
  };

  return (
    <div>
      <AppBar position="static" style={{ backgroundColor: '#123456', height: '64px' }}>
        <Toolbar style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box display="flex" alignItems="center">
            <Button color="inherit" onClick={handleAboutOpen} style={{ textTransform: 'none' }}>
              <Typography variant="h6">
                RankMe
              </Typography>
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <About open={aboutDialogOpen} onClose={handleAboutClose} />

      <Tabs
        value={activeTabId}
        onChange={(e, value) => setActiveTabId(value)}
        variant="scrollable"
        scrollButtons="auto"
        style={{ borderBottom: '1px solid #ddd' }}
      >
        {tabs.map(tab => (
          <Tab
            key={tab.id}
            value={tab.id}
            label={
              tab.id === SEARCH_TAB_ID ? (
                'Search'
              ) : (
                <span title={tab.label} style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 160 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tab.label}
                  </span>
                  <CloseIcon
                    fontSize="small"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    style={{ flexShrink: 0 }}
                  />
                </span>
              )
            }
          />
        ))}
      </Tabs>

      {tabs.map(tab => (
        <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
          {tab.type === 'search' && <AuthorSearch onOpenAuthor={openAuthorTab} searchRequest={searchRequest} />}
          {tab.type === 'dblp-author' && <Author pid={tab.pid} onOpenAuthor={openAuthorTab} />}
          {tab.type === 'hal-author' && <AuthorHal id={tab.halId} authorName={tab.authorName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} />}
        </div>
      ))}
    </div>
  );
}

export default App;
