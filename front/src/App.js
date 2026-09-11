import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Material-UI Components and Icons
import { AppBar, Toolbar, Typography, Button, IconButton, Box, Tabs, Tab, Divider } from '@mui/material';
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
import { CategoriesFilterButton } from './component/CategoriesFilterButton';
import { RankingSourceIndicator } from './component/RankingSourceIndicator';
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
  const isPersistentTab = t => t.id === SEARCH_TAB_ID || t.id === TEAMS_TAB_ID || t.id === STRUCTURES_TAB_ID;
  const visibleTabs = tabs.filter(t => (
    isPersistentTab(t) || (
      context === 'teams' ? t.type === 'team'
        : context === 'structures' ? t.type === 'hal-structure'
        : t.type === 'dblp-author' || t.type === 'hal-author'
    )
  ));
  // Author/Teams/Structure (the 3 ways to switch context, always present)
  // vs. whatever's actually been opened under the current one (a specific
  // author, team, or structure) -- kept visually distinct below (a divider,
  // and a card-like background only on the latter) since they're not the
  // same kind of tab: these three don't close and don't represent "a page
  // you're looking at", they're the navigation itself.
  const persistentVisibleTabs = visibleTabs.filter(isPersistentTab);
  const dynamicVisibleTabs = visibleTabs.filter(t => !isPersistentTab(t));
  // MUI's own Tabs indicator only ever tracks the literal selection
  // (activeTabId) -- fine when that's Author/Teams/Structure itself, but
  // when it's a dynamic tab underneath one of them (e.g. a specific
  // author), the indicator moves to that dynamic tab and Author is left
  // looking unselected even though it's still the active section. This id
  // gets a manual underline below (separate from, and in addition to,
  // MUI's own indicator wherever that currently is) so the context stays
  // visible regardless of which dynamic tab is open.
  const contextTabId = context === 'teams' ? TEAMS_TAB_ID : context === 'structures' ? STRUCTURES_TAB_ID : SEARCH_TAB_ID;

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
            <RankingSourceIndicator onOpenSettings={() => setSettingsDialogOpen(true)} />
            <CategoriesFilterButton />
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
        sx={{
          '& .MuiTab-root': { textTransform: 'capitalize' },
          // MUI centers each Tab's own content vertically within its own
          // height, not against the row -- flex-end on the row itself is
          // what makes a dynamic tab's smaller minHeight below actually
          // read as "sitting on the line" rather than floating in the
          // middle of it.
          '& .MuiTabs-flexContainer': { alignItems: 'flex-end' },
        }}
      >
        {persistentVisibleTabs.map(tab => (
          <Tab
            key={tab.id}
            value={tab.id}
            label={tab.id === SEARCH_TAB_ID ? 'Author' : tab.id === TEAMS_TAB_ID ? 'Teams' : 'Structure'}
            // The context this tab represents stays underlined even while
            // a dynamic tab underneath it is the one actually selected --
            // MUI's own sliding indicator already covers the case where
            // this tab itself is the selection, so this only adds the
            // extra underline for the "context, but not literal
            // selection" case, to avoid doubling up on thickness.
            sx={tab.id === contextTabId && tab.id !== activeTabId
              ? { borderBottom: '2px solid', borderColor: 'primary.main' }
              : undefined}
          />
        ))}

        <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.5 }} />

        {dynamicVisibleTabs.map(tab => (
          <Tab
            key={tab.id}
            value={tab.id}
            // Materializes each opened author/team/structure as its own
            // small card sitting on the tab bar -- distinct from the
            // plain Author/Teams/Structure tabs to its left, which are
            // navigation itself rather than "a page you have open". A
            // lighter base grey (vs. the first attempt) leaves room for the
            // selected one to actually read as more prominent, not just
            // differently-colored.
            sx={{
              backgroundColor: tab.id === activeTabId ? '#eeeeee' : '#fafafa',
              fontWeight: tab.id === activeTabId ? 700 : 400,
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
              minHeight: 24,
              py: 1,
              mx: 0.5,
            }}
            label={
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
            }
          />
        ))}
      </Tabs>

      {tabs.map(tab => (
        <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
          {tab.type === 'search' && <AuthorSearch onOpenAuthor={openAuthorTab} searchRequest={searchRequest} />}
          {tab.type === 'teams' && <Teams onOpenAuthor={openAuthorTab} />}
          {/* isActive (tab.id === activeTabId) is threaded down to each of
              these four's Publications/HalPublications so a backgrounded
              tab's row list can skip rendering entirely instead of
              reconciling on every streamed SSE flush behind display:none --
              the rest of each page (chart, summary, filters) stays as cheap
              as it already was and keeps re-rendering normally. */}
          {tab.type === 'dblp-author' && <Author pid={tab.pid} onOpenAuthor={openAuthorTab} onNameResolved={(name) => updateTabInfo(tab.id, { label: name })} isActive={tab.id === activeTabId} />}
          {tab.type === 'hal-author' && <AuthorHal id={tab.halId} authorName={tab.authorName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} onNameResolved={(name) => updateTabInfo(tab.id, { authorName: name, label: name })} isActive={tab.id === activeTabId} />}
          {tab.type === 'team' && <Team teamId={tab.teamId} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} isActive={tab.id === activeTabId} />}
          {tab.type === 'structures' && <StructureSearch onOpenStructure={openAuthorTab} />}
          {tab.type === 'hal-structure' && <Structure structId={tab.structId} structureName={tab.structureName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} onNameResolved={(name) => updateTabInfo(tab.id, { structureName: name, label: name })} isActive={tab.id === activeTabId} />}
        </div>
      ))}
    </div>
  );
}

export default App;
