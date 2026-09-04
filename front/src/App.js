import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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

// The URL is the source of truth for which author page is open, so a link
// to it can be shared/reloaded. Kept deliberately simple (regex match on
// the raw pathname, not a <Routes>/<Route> tree) since every tab is already
// mounted at once and toggled via display:none/block to preserve its state
// across switches — real route matching would fight that.
function tabPath(tab) {
  if (tab.type === 'dblp-author') return `/dblp/${tab.pid}`;
  if (tab.type === 'hal-author') return `/hal/${tab.halId}`;
  return '/';
}

function tabFromPath(pathname) {
  let m = pathname.match(/^\/dblp\/(.+)$/);
  if (m) {
    const pid = decodeURIComponent(m[1]);
    return { type: 'dblp-author', id: `dblp:${pid}`, pid, label: pid };
  }
  m = pathname.match(/^\/hal\/(.+)$/);
  if (m) {
    const halId = decodeURIComponent(m[1]);
    return { type: 'hal-author', id: `hal:${halId}`, halId, authorName: undefined, label: halId };
  }
  return { id: SEARCH_TAB_ID, type: 'search' };
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [tabs, setTabs] = useState(() => {
    const fromUrl = tabFromPath(location.pathname);
    return fromUrl.id === SEARCH_TAB_ID ? [fromUrl] : [{ id: SEARCH_TAB_ID, type: 'search' }, fromUrl];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabFromPath(location.pathname).id);
  const [searchRequest, setSearchRequest] = useState(null);

  const handleAboutOpen = () => setAboutDialogOpen(true);
  const handleAboutClose = () => setAboutDialogOpen(false);

  const openAuthorTab = (tab) => {
    setTabs(prev => (prev.some(t => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
  };

  // Active tab -> URL (opening/switching/closing tabs all funnel through
  // activeTabId, so this alone keeps the address bar in sync).
  useEffect(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;
    const path = tabPath(activeTab);
    if (location.pathname !== path) navigate(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, tabs]);

  // URL -> tabs/active tab, for browser back/forward and for opening a
  // shared link directly. Each setter bails out on an unchanged value, so
  // this can't fight the effect above once they agree.
  useEffect(() => {
    const fromUrl = tabFromPath(location.pathname);
    setTabs(prev => (prev.some(t => t.id === fromUrl.id) ? prev : [...prev, fromUrl]));
    setActiveTabId(fromUrl.id);
  }, [location.pathname]);

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
