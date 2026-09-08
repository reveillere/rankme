import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Material-UI Components and Icons
import { AppBar, Toolbar, Typography, Button, IconButton, Box, Tabs, Tab } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import RuleIcon from '@mui/icons-material/Rule';

// Custom Components
import AuthorSearch from './component/Search';
import { Author } from './component/Author';
import { AuthorHal } from './component/AuthorHal';
import { Team } from './component/Team';
import Teams from './component/Teams';
import { Structure } from './component/Structure';
import StructureSearch from './component/StructureSearch';
import About, { HIDE_ON_START_KEY } from './component/About';
import { SettingsDialog } from './component/SettingsDialog';
import { MyOverridesDialog } from './component/MyOverridesDialog';
import { recordSearchHistory } from './searchHistory';

// Styles and Other
import './App.css';
import './utils.js';


const SEARCH_TAB_ID = 'search';
const TEAMS_TAB_ID = 'teams';
const STRUCTURES_TAB_ID = 'structures';
const PERSISTENT_TABS = [{ id: SEARCH_TAB_ID, type: 'search' }, { id: TEAMS_TAB_ID, type: 'teams' }, { id: STRUCTURES_TAB_ID, type: 'structures' }];

// The URL is the source of truth for which author page is open, so a link
// to it can be shared/reloaded. Kept deliberately simple (regex match on
// the raw pathname, not a <Routes>/<Route> tree) since every tab is already
// mounted at once and toggled via display:none/block to preserve its state
// across switches — real route matching would fight that.
function tabPath(tab) {
  if (tab.type === 'dblp-author') return `/dblp/${tab.pid}`;
  if (tab.type === 'hal-author') return `/hal/${tab.halId}`;
  if (tab.type === 'team') return `/team/${tab.teamId}`;
  if (tab.type === 'teams') return '/teams';
  if (tab.type === 'hal-structure') return `/structure/${tab.structId}`;
  if (tab.type === 'structures') return '/structures';
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
  m = pathname.match(/^\/team\/(.+)$/);
  if (m) {
    const teamId = decodeURIComponent(m[1]);
    return { type: 'team', id: `team:${teamId}`, teamId, label: teamId };
  }
  m = pathname.match(/^\/structure\/(.+)$/);
  if (m) {
    const structId = decodeURIComponent(m[1]);
    return { type: 'hal-structure', id: `hal-structure:${structId}`, structId, structureName: undefined, label: structId };
  }
  if (pathname === '/teams') {
    return { id: TEAMS_TAB_ID, type: 'teams' };
  }
  if (pathname === '/structures') {
    return { id: STRUCTURES_TAB_ID, type: 'structures' };
  }
  return { id: SEARCH_TAB_ID, type: 'search' };
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [aboutDialogOpen, setAboutDialogOpen] = useState(() => localStorage.getItem(HIDE_ON_START_KEY) !== 'true');
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [overridesDialogOpen, setOverridesDialogOpen] = useState(false);
  const [tabs, setTabs] = useState(() => {
    const fromUrl = tabFromPath(location.pathname);
    return PERSISTENT_TABS.some(t => t.id === fromUrl.id) ? PERSISTENT_TABS : [...PERSISTENT_TABS, fromUrl];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabFromPath(location.pathname).id);
  const [searchRequest, setSearchRequest] = useState(null);

  const handleAboutOpen = () => setAboutDialogOpen(true);
  const handleAboutClose = () => setAboutDialogOpen(false);

  const openAuthorTab = (tab) => {
    setTabs(prev => (prev.some(t => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
    recordSearchHistory(tab);
  };

  // A tab opened by bare id (or reloaded from a bare URL) doesn't know its
  // own display name yet -- e.g. Structure.js looks its name up after the
  // fact and calls this to patch both the tab bar label and the recorded
  // history entry, instead of leaving them stuck on the raw id forever.
  const updateTabInfo = (tabId, patch) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...patch } : t)));
    recordSearchHistory({ ...tabs.find(t => t.id === tabId), ...patch });
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

  // The tab bar only shows tabs belonging to whichever of Author/Teams/
  // Structure is the active context (that persistent tab itself, or a
  // dynamic tab opened from it) -- the three persistent tabs stay visible
  // as the ways to switch context. Every tab stays mounted below regardless
  // (see the tabs.map for content further down) so switching context back
  // and forth doesn't lose anything, it's only the tab bar that's filtered.
  const activeTab = tabs.find(t => t.id === activeTabId);
  const context = activeTab && (activeTab.type === 'teams' || activeTab.type === 'team') ? 'teams'
    : activeTab && (activeTab.type === 'structures' || activeTab.type === 'hal-structure') ? 'structures'
    : 'search';
  const visibleTabs = tabs.filter(t => (
    t.id === SEARCH_TAB_ID || t.id === TEAMS_TAB_ID || t.id === STRUCTURES_TAB_ID || (
      context === 'teams' ? t.type === 'team'
        : context === 'structures' ? t.type === 'hal-structure'
        : t.type === 'dblp-author' || t.type === 'hal-author'
    )
  ));

  return (
    <div>
      <AppBar position="sticky" style={{ backgroundColor: '#123456', height: '64px', top: 0, zIndex: 1201 }}>
        <Toolbar style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box display="flex" alignItems="center">
            <Button color="inherit" onClick={handleAboutOpen} style={{ textTransform: 'none' }}>
              <Typography variant="h6">
                About
              </Typography>
            </Button>
          </Box>
          <Box display="flex" alignItems="center">
            <IconButton color="inherit" onClick={() => setOverridesDialogOpen(true)} aria-label="my match corrections">
              <RuleIcon />
            </IconButton>
            <IconButton color="inherit" onClick={() => setSettingsDialogOpen(true)} aria-label="settings">
              <SettingsIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <About open={aboutDialogOpen} onClose={handleAboutClose} />
      <SettingsDialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} />
      <MyOverridesDialog open={overridesDialogOpen} onClose={() => setOverridesDialogOpen(false)} />

      <Tabs
        value={activeTabId}
        onChange={(e, value) => setActiveTabId(value)}
        variant="scrollable"
        scrollButtons="auto"
        style={{ borderBottom: '1px solid #ddd', backgroundColor: '#fff', position: 'sticky', top: 64, zIndex: 1200 }}
        sx={{ '& .MuiTab-root': { textTransform: 'capitalize' } }}
      >
        {visibleTabs.map(tab => (
          <Tab
            key={tab.id}
            value={tab.id}
            label={
              tab.id === SEARCH_TAB_ID ? (
                'Author'
              ) : tab.id === TEAMS_TAB_ID ? (
                'Teams'
              ) : tab.id === STRUCTURES_TAB_ID ? (
                'Structure'
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
          {tab.type === 'teams' && <Teams onOpenAuthor={openAuthorTab} />}
          {tab.type === 'dblp-author' && <Author pid={tab.pid} onOpenAuthor={openAuthorTab} />}
          {tab.type === 'hal-author' && <AuthorHal id={tab.halId} authorName={tab.authorName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} />}
          {tab.type === 'team' && <Team teamId={tab.teamId} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} />}
          {tab.type === 'structures' && <StructureSearch onOpenStructure={openAuthorTab} />}
          {tab.type === 'hal-structure' && <Structure structId={tab.structId} structureName={tab.structureName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} onNameResolved={(name) => updateTabInfo(tab.id, { structureName: name, label: name })} />}
        </div>
      ))}
    </div>
  );
}

export default App;
