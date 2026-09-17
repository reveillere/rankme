import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Material-UI Components and Icons
import { AppBar, Toolbar, Typography, Button, IconButton, Box, Tabs, Tab, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import RuleIcon from '@mui/icons-material/Rule';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';

// Custom Components
import AuthorSearch from './component/Search';
import { Author } from './component/Author';
import { AuthorHal } from './component/AuthorHal';
import { Team } from './component/Team';
import Teams from './component/Teams';
import { Structure } from './component/Structure';
import StructureSearch from './component/StructureSearch';
import { CrossCheck } from './component/CrossCheck';
import { CrossCheckTeam } from './component/CrossCheckTeam';
import { CrossCheckStructure } from './component/CrossCheckStructure';
import About, { HIDE_ON_START_KEY } from './component/About';
import { SettingsDialog } from './component/SettingsDialog';
import { CategoriesFilterButton } from './component/CategoriesFilterButton';
import { RankingSourceIndicator } from './component/RankingSourceIndicator';
import { MyOverridesDialog } from './component/MyOverridesDialog';
import { MyCustomRankingsDialog } from './component/MyCustomRankingsDialog';
import { HelpButton } from './component/HelpButton';
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
// yearRange (?from=&to=), sort (?sort=) and export (?export=) for the 4 tab
// types that carry all three (dblp-author/hal-author/team/hal-structure) --
// same "omit when absent/default" rule for yearRange/sort, see their own
// comments; export has no default to omit (it's a one-shot trigger, not a
// persistent view setting -- see initialExport's own comment on each of the
// 4 pages), so it's simply included whenever set and never cleared
// afterwards -- a URL carrying it (e.g. .../dblp/11/1262?sort=rank-date&
// export=md) stays a valid, replayable "share this export" link. Built with
// URLSearchParams (not hand-joined like crosscheck-author's) so adding
// sort/export here didn't require rewriting every branch that already had a
// working yearRange-only string.
function tabSearch(tab) {
  const params = new URLSearchParams();
  if (Array.isArray(tab.yearRange)) {
    params.set('from', tab.yearRange[0]);
    params.set('to', tab.yearRange[1]);
  }
  if (tab.sort && tab.sort !== 'date') params.set('sort', tab.sort);
  if (tab.export === 'md' || tab.export === 'json' || tab.export === 'csv') params.set('export', tab.export);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function tabPath(tab) {
  if (tab.type === 'dblp-author') return `/dblp/${tab.pid}${tabSearch(tab)}`;
  if (tab.type === 'hal-author') return `/hal/${tab.halId}${tabSearch(tab)}`;
  if (tab.type === 'team') return `/team/${tab.teamId}${tabSearch(tab)}`;
  if (tab.type === 'teams') return '/teams';
  if (tab.type === 'hal-structure') return `/structure/${tab.structId}${tabSearch(tab)}`;
  if (tab.type === 'structures') return '/structures';
  if (tab.type === 'crosscheck-author') {
    const base = '/crosscheck/dblp/' + tab.pid + '/hal/' + tab.halId;
    // yearRange (the DBLP author page's own year filter, active when
    // "Cross-check with HAL" was clicked -- see Author.js's
    // handleCrossCheckConfirm) is carried in the URL as ?from=&to= so a
    // shared/reloaded link reproduces the same filtered view. Omitted
    // entirely when absent -- CrossCheck.js itself treats a missing range
    // as "don't filter" (see tabFromPath below), which is the reasonable
    // default for a bare /crosscheck/... link typed or shared without it.
    return Array.isArray(tab.yearRange) ? `${base}?from=${tab.yearRange[0]}&to=${tab.yearRange[1]}` : base;
  }
  // A team has no server-side identity at all (front/src/teamStore.js,
  // localStorage only) -- unlike crosscheck-author's pid/halId pair above,
  // there is no (source, pids) pair stable enough to put in the URL itself:
  // the member list can change client-side any time. :teamId here is only
  // ever used to look the team back up via teamStore.js at render time (see
  // CrossCheckTeam.js), not sent to the server as-is -- same as the plain
  // /team/:teamId route already does for Team.js. yearRange travels as
  // ?from=&to=, same bespoke (not tabSearch's) serialization as
  // crosscheck-author above -- neither crosscheck page has a sort/export
  // control of its own for tabSearch's other fields to ever be set.
  if (tab.type === 'crosscheck-team') {
    const base = '/crosscheck/team/' + tab.teamId;
    return Array.isArray(tab.yearRange) ? `${base}?from=${tab.yearRange[0]}&to=${tab.yearRange[1]}` : base;
  }
  // A HAL structure DOES have a stable server-side structId (unlike a team
  // above) -- so :structId here plays the same role hal-structure's own
  // :structId already does, just under /crosscheck/structure instead of
  // /structure.
  if (tab.type === 'crosscheck-structure') {
    const base = '/crosscheck/structure/' + tab.structId;
    return Array.isArray(tab.yearRange) ? `${base}?from=${tab.yearRange[0]}&to=${tab.yearRange[1]}` : base;
  }
  return '/';
}

function tabFromPath(pathname, search) {
  // Checked before the plain /dblp/(.+)$ branch below -- otherwise that
  // one's own greedy (.+) would swallow this whole path (including the
  // "/hal/<halId>" suffix) as if it were just a dblp pid.
  let m = pathname.match(/^\/crosscheck\/dblp\/(.+)\/hal\/(.+)$/);
  if (m) {
    const pid = decodeURIComponent(m[1]);
    const halId = decodeURIComponent(m[2]);
    // ?from=&to=, see tabPath above -- both must parse as numbers or the
    // range is dropped entirely (CrossCheck.js's own hasYearRange check
    // then shows everything unfiltered, rather than crashing on a
    // malformed or partial query string).
    const params = new URLSearchParams(search || '');
    const from = parseInt(params.get('from'), 10);
    const to = parseInt(params.get('to'), 10);
    const yearRange = Number.isFinite(from) && Number.isFinite(to) ? [from, to] : undefined;
    return { type: 'crosscheck-author', id: `crosscheck:${pid}:${halId}`, pid, halId, label: pid, yearRange };
  }
  m = pathname.match(/^\/crosscheck\/team\/(.+)$/);
  if (m) {
    const teamId = decodeURIComponent(m[1]);
    // ?from=&to=, see tabPath above and crosscheck-author's identical
    // parsing -- both must parse as numbers or the range is dropped
    // entirely. label is the raw teamId, same minimalism as the plain
    // /team/:teamId branch below -- CrossCheckTeam.js/Team.js already look
    // the team's own name up via teamStore.js once rendered, this is only
    // ever the tab bar's fallback label.
    const params = new URLSearchParams(search || '');
    const from = parseInt(params.get('from'), 10);
    const to = parseInt(params.get('to'), 10);
    const yearRange = Number.isFinite(from) && Number.isFinite(to) ? [from, to] : undefined;
    return { type: 'crosscheck-team', id: `crosscheck-team:${teamId}`, teamId, label: teamId, yearRange };
  }
  m = pathname.match(/^\/crosscheck\/structure\/(.+)$/);
  if (m) {
    const structId = decodeURIComponent(m[1]);
    // ?from=&to=, same parsing as crosscheck-team above. label/structureName
    // are the raw structId, same minimalism as the plain /structure/:id
    // branch below -- Structure.js's button already knows the resolved name
    // when navigating here directly (see Structure.js's
    // handleCrossCheckStructure), this is only ever the fallback for a
    // reloaded/shared bare URL.
    const params = new URLSearchParams(search || '');
    const from = parseInt(params.get('from'), 10);
    const to = parseInt(params.get('to'), 10);
    const yearRange = Number.isFinite(from) && Number.isFinite(to) ? [from, to] : undefined;
    return { type: 'crosscheck-structure', id: `crosscheck-structure:${structId}`, structId, structureName: undefined, label: structId, yearRange };
  }
  // ?from=&to=, see tabPath above -- same parsing as crosscheck-author's own
  // yearRange: both must parse as numbers or the range is dropped entirely,
  // rather than crashing on a malformed or partial query string.
  const yearRangeFromSearch = () => {
    const params = new URLSearchParams(search || '');
    const from = parseInt(params.get('from'), 10);
    const to = parseInt(params.get('to'), 10);
    return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : undefined;
  };
  // ?sort=, see tabPath/tabSearch above -- undefined (not 'date') for
  // anything other than one of the two non-default modes, so a malformed or
  // absent value falls back to each page's own 'date' default the same way
  // an unparseable yearRange falls back to unfiltered.
  const sortFromSearch = () => {
    const params = new URLSearchParams(search || '');
    const sort = params.get('sort');
    return sort === 'date-rank' || sort === 'rank-date' ? sort : undefined;
  };
  // ?export=, see tabPath/tabSearch above -- undefined for anything other
  // than 'md'/'csv', so a malformed or absent value just means "don't
  // auto-download", same fallback shape as sortFromSearch above.
  const exportFromSearch = () => {
    const params = new URLSearchParams(search || '');
    const exp = params.get('export');
    return exp === 'md' || exp === 'json' || exp === 'csv' ? exp : undefined;
  };
  m = pathname.match(/^\/dblp\/(.+)$/);
  if (m) {
    const pid = decodeURIComponent(m[1]);
    return { type: 'dblp-author', id: `dblp:${pid}`, pid, label: pid, yearRange: yearRangeFromSearch(), sort: sortFromSearch(), export: exportFromSearch() };
  }
  m = pathname.match(/^\/hal\/(.+)$/);
  if (m) {
    const halId = decodeURIComponent(m[1]);
    return { type: 'hal-author', id: `hal:${halId}`, halId, authorName: undefined, label: halId, yearRange: yearRangeFromSearch(), sort: sortFromSearch(), export: exportFromSearch() };
  }
  m = pathname.match(/^\/team\/(.+)$/);
  if (m) {
    const teamId = decodeURIComponent(m[1]);
    return { type: 'team', id: `team:${teamId}`, teamId, label: teamId, yearRange: yearRangeFromSearch(), sort: sortFromSearch(), export: exportFromSearch() };
  }
  m = pathname.match(/^\/structure\/(.+)$/);
  if (m) {
    const structId = decodeURIComponent(m[1]);
    return { type: 'hal-structure', id: `hal-structure:${structId}`, structId, structureName: undefined, label: structId, yearRange: yearRangeFromSearch(), sort: sortFromSearch(), export: exportFromSearch() };
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
  const [customRankingsDialogOpen, setCustomRankingsDialogOpen] = useState(false);
  const [tabs, setTabs] = useState(() => {
    const fromUrl = tabFromPath(location.pathname, location.search);
    return PERSISTENT_TABS.some(t => t.id === fromUrl.id) ? PERSISTENT_TABS : [...PERSISTENT_TABS, fromUrl];
  });
  const [activeTabId, setActiveTabId] = useState(() => tabFromPath(location.pathname, location.search).id);
  const [searchRequest, setSearchRequest] = useState(null);

  // API tokens belong to external clients, never to the browser interface.
  // Clear the legacy preference once for visitors who used an earlier build.
  useEffect(() => {
    localStorage.removeItem('rankme:api-token');
  }, []);

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
    if (location.pathname + location.search !== path) navigate(path);
  }, [activeTabId, tabs, location.pathname, location.search, navigate]);

  // URL -> tabs/active tab, for browser back/forward and for opening a
  // shared link directly. Each setter bails out on an unchanged value, so
  // this can't fight the effect above once they agree.
  useEffect(() => {
    const fromUrl = tabFromPath(location.pathname, location.search);
    setTabs(prev => (prev.some(t => t.id === fromUrl.id) ? prev : [...prev, fromUrl]));
    setActiveTabId(fromUrl.id);
  }, [location.pathname, location.search]);

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
  const context = activeTab && (activeTab.type === 'teams' || activeTab.type === 'team' || activeTab.type === 'crosscheck-team') ? 'teams'
    : activeTab && (activeTab.type === 'structures' || activeTab.type === 'hal-structure' || activeTab.type === 'crosscheck-structure') ? 'structures'
    : 'search';
  const isPersistentTab = t => t.id === SEARCH_TAB_ID || t.id === TEAMS_TAB_ID || t.id === STRUCTURES_TAB_ID;
  const visibleTabs = tabs.filter(t => (
    isPersistentTab(t) || (
      context === 'teams' ? (t.type === 'team' || t.type === 'crosscheck-team')
        : context === 'structures' ? (t.type === 'hal-structure' || t.type === 'crosscheck-structure')
        : t.type === 'dblp-author' || t.type === 'hal-author' || t.type === 'crosscheck-author'
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
            <HelpButton
              label="Help"
              color="inherit"
              title="RankMe help"
              sections={[
                { title: 'Explore sources', description: 'Use Author to search DBLP or HAL identities. Structures are predefined HAL teams; Teams lets you create your own HAL or DBLP groups.' },
                { title: 'Ranking source', description: 'The source badge in the top bar shows the current conference and journal ranking sources. Click it, or use Settings, to choose CORE, SJR, CCF or a custom ranking profile.' },
                { title: 'Category and rank filter', description: 'The funnel button opens the current-view filter. Select publication categories and the ranking letters to include; category and rank choices constrain each other.' },
                { title: 'Match corrections', description: 'The rules button opens your manual CORE/SJR/CCF match corrections. Review, remove, import or export corrections stored in this browser.' },
                { title: 'Custom rankings', description: 'The leaderboard button manages custom ranking profiles. Create a profile and assign ranks to venues when the standard sources do not fit your use case.' },
                { title: 'Read records', description: 'On a Records page, filters and sorting change the records shown. Export downloads the current view as Markdown, JSON or CSV. Its URL can be shared with ?export=md, ?export=json or ?export=csv.' },
                { title: 'Build teams', description: 'A team has one source and a unique name. Typed ids, bulk entries and TXT files are validated before they are added. Team imports use JSON or CSV; member imports also accept TXT.' },
                { title: 'Resolve identities and cross-check', description: 'Identity links connect a HAL idHal with a DBLP PID. Confirm or select a proposal, then cross-check to find records present on one source but absent from the other.' },
                { title: 'More help', description: 'Use the ? icon on Records, Teams, Identity links and Cross-check for format examples and instructions specific to that screen.' },
              ]}
            />
          </Box>
          <Box display="flex" alignItems="center">
            <RankingSourceIndicator onOpenSettings={() => setSettingsDialogOpen(true)} />
            <CategoriesFilterButton />
            <IconButton color="inherit" onClick={() => setOverridesDialogOpen(true)} aria-label="my match corrections">
              <RuleIcon />
            </IconButton>
            <IconButton color="inherit" onClick={() => setCustomRankingsDialogOpen(true)} aria-label="my custom rankings">
              <LeaderboardIcon />
            </IconButton>
            <IconButton color="inherit" onClick={() => setSettingsDialogOpen(true)} aria-label="settings">
              <SettingsIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <About open={aboutDialogOpen} onClose={handleAboutClose} />
      <SettingsDialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} onManageCustomRankings={() => setCustomRankingsDialogOpen(true)} />
      <MyOverridesDialog open={overridesDialogOpen} onClose={() => setOverridesDialogOpen(false)} />
      <MyCustomRankingsDialog open={customRankingsDialogOpen} onClose={() => setCustomRankingsDialogOpen(false)} />

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
          {tab.type === 'search' && <AuthorSearch onOpenAuthor={openAuthorTab} searchRequest={searchRequest} isActive={tab.id === activeTabId} />}
          {tab.type === 'teams' && <Teams onOpenAuthor={openAuthorTab} />}
          {/* isActive (tab.id === activeTabId) is threaded down to each of
              these four's Publications/HalPublications so a backgrounded
              tab's row list can skip rendering entirely instead of
              reconciling on every streamed SSE flush behind display:none --
              the rest of each page (chart, summary, filters) stays as cheap
              as it already was and keeps re-rendering normally. */}
          {tab.type === 'dblp-author' && <Author pid={tab.pid} onOpenAuthor={openAuthorTab} onNameResolved={(name) => updateTabInfo(tab.id, { label: name })} isActive={tab.id === activeTabId} initialYearRange={tab.yearRange} onYearRangeChange={(range) => updateTabInfo(tab.id, { yearRange: range })} initialSort={tab.sort} onSortChange={(sort) => updateTabInfo(tab.id, { sort })} initialExport={tab.export} />}
          {tab.type === 'hal-author' && <AuthorHal id={tab.halId} authorName={tab.authorName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} onNameResolved={(name) => updateTabInfo(tab.id, { authorName: name, label: name })} isActive={tab.id === activeTabId} initialYearRange={tab.yearRange} onYearRangeChange={(range) => updateTabInfo(tab.id, { yearRange: range })} initialSort={tab.sort} onSortChange={(sort) => updateTabInfo(tab.id, { sort })} initialExport={tab.export} />}
          {tab.type === 'team' && <Team teamId={tab.teamId} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} isActive={tab.id === activeTabId} initialYearRange={tab.yearRange} onYearRangeChange={(range) => updateTabInfo(tab.id, { yearRange: range })} initialSort={tab.sort} onSortChange={(sort) => updateTabInfo(tab.id, { sort })} initialExport={tab.export} />}
          {tab.type === 'structures' && <StructureSearch onOpenStructure={openAuthorTab} />}
          {tab.type === 'hal-structure' && <Structure structId={tab.structId} structureName={tab.structureName} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} onNameResolved={(name) => updateTabInfo(tab.id, { structureName: name, label: name })} isActive={tab.id === activeTabId} initialYearRange={tab.yearRange} onYearRangeChange={(range) => updateTabInfo(tab.id, { yearRange: range })} initialSort={tab.sort} onSortChange={(sort) => updateTabInfo(tab.id, { sort })} initialExport={tab.export} />}
          {tab.type === 'crosscheck-author' && <CrossCheck pid={tab.pid} halId={tab.halId} yearRange={tab.yearRange} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} isActive={tab.id === activeTabId} />}
          {tab.type === 'crosscheck-team' && <CrossCheckTeam teamId={tab.teamId} yearRange={tab.yearRange} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} isActive={tab.id === activeTabId} />}
          {tab.type === 'crosscheck-structure' && <CrossCheckStructure structId={tab.structId} structureName={tab.structureName} yearRange={tab.yearRange} onOpenAuthor={openAuthorTab} onSearchAuthor={searchAuthorByName} isActive={tab.id === activeTabId} />}
        </div>
      ))}
    </div>
  );
}

export default App;
