// User-facing "What's new" history for About.js's changelog accordion.
// Grouped by minor version (patch releases within a minor are folded into
// it) since most patch bumps only ever carried internal/infra changes -- see
// the version bump commits in front/package.json's git history for the full
// technical log. Newest first.
export const CHANGELOG = [
  { version: '0.15', items: [
    'Added this "What’s new" changelog to the About dialog.',
  ] },
  { version: '0.14', items: [
    "Team and structure member lists now show each member's ORCID, on screen and in exports.",
  ] },
  { version: '0.13', items: [
    'No user-visible change (internal infra/perf/security).',
  ] },
  { version: '0.12', items: [
    'Fixed HAL author pages for researchers without a claimed HAL account.',
    'Fixed an export/filter error with very large correction/profile sets.',
  ] },
  { version: '0.11', items: [
    'Added optional anonymous account sync across devices (no email needed).',
    'Preferences can now be exported/imported as a file, like teams already could.',
    'Added "Delete all" for teams; corrections now also require 90% agreement among recent votes.',
  ] },
  { version: '0.10', items: [
    'Identity links and cross-check decisions are now personal to your browser, with export/import to collaborate.',
    'Confirmed matches show in a collapsible section with Undo.',
    'Fixed structure cross-check reports skipping their cache (faster repeat visits).',
  ] },
  { version: '0.9', items: [
    '"My match corrections"/"My custom rankings" exportable as JSON; CCF matches can now be corrected like CORE/SJR.',
    'The public API can now apply your personal/community corrections and custom rankings, including year filtering on cross-check.',
    'Community corrections now need agreement from 10 people (up from 3).',
  ] },
  { version: '0.8', items: [
    'Added contextual Help (?) buttons throughout the app.',
    'Identity Links panel: one-click confirm/select, CSV/Markdown export, shareable export URLs.',
    'Team creation now validates ids and blocks duplicate names; fixed an infinite-reload bug and a broken API docs redirect.',
  ] },
  { version: '0.7', items: [
    'New "Cross-check with HAL" feature, with an identity-links panel to manage confirmed DBLP↔HAL links.',
    'Unified export (Markdown/JSON/CSV) and sort options across all pages.',
  ] },
  { version: '0.6', items: [
    'Conference and journal ranking sources can now be chosen independently; added custom ranking profiles.',
    'Shows "Queued — N ahead of you" with live updates instead of a frozen "0%".',
    'Fixed stale DBLP search results after a snapshot refresh; fixed venue names showing raw HTML entities; DBLP banner now shows the snapshot date/DOI.',
    'Added a brief anti-scraping "checking your browser" step on first visit (then fixed it failing in some browsers).',
  ] },
  { version: '0.5', items: [
    'Added CCF as an alternative ranking source.',
    'Fixed ranking progress getting stuck, crashes on very short lists, duplicate rows while scrolling.',
    'Fixed community corrections sometimes silently ignored due to a cache bug.',
  ] },
  { version: '0.4', items: [
    'Fixed the "needs review" filter/count incorrectly including already-confirmed publications.',
    'Reorganized the tab bar; added bulk-import of team members from a pasted list or file.',
    'Fixed the app freezing on large pages, and duplicate/missing publications from HAL.',
  ] },
  { version: '0.3', items: [
    'Recent searches are now scoped to the active tab (DBLP vs. HAL) and show each person’s affiliation.',
    'The About dialog now shows the release date next to the version number.',
  ] },
  { version: '0.2', items: [
    'Search a HAL "structure" (lab, institution, team) and view every publication ever affiliated with it, ranked.',
    'Click any rank badge to see match confidence against CORE/SJR and manually confirm/correct it yourself (export/import as CSV); each HAL paper links to its HAL page.',
    'Fixed large HAL labs (10,000+ publications) being truncated to 1,000 records; fixed papers stuck showing "Unranked" after a server restart.',
  ] },
  { version: '0.1', items: [
    'Group several DBLP/HAL authors into a "Team" and view their merged, deduplicated publications ranked together.',
    'Open an author page directly by DBLP PID or HAL id ("search by identifier"), and reopen past lookups from a new "Recent" list.',
    'Author/team pages now have shareable URLs; rank/category filters moved into one global Settings dialog; long lookups show a progress bar.',
  ] },
];
