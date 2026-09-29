// User-facing "What's new" history for About.js's changelog accordion.
// Grouped by minor version (patch releases within a minor are folded into
// it) since most patch bumps only ever carried internal/infra changes -- see
// the version bump commits in front/package.json's git history for the full
// technical log. Newest first.
export const CHANGELOG = [
  { version: '0.25', items: [
    'Every cross-check section (Missing from HAL, Not claimed on HAL, To review, Confirmed by you, Confirmed automatically) is now collapsible, consistently styled, and only shown when it actually has something in it.',
    '"Confirmed" renamed to "Confirmed by you", to distinguish it from the new "Confirmed automatically" section next to it.',
  ] },
  { version: '0.24', items: [
    'Fixed cramped icon spacing on the cross-check page\'s header row.',
    'Automatically-confirmed cross-check matches now have their own collapsed-by-default section (view them without downloading a report), instead of just a count.',
  ] },
  { version: '0.23', items: [
    'Cross-check pages now show the author/team/structure name in their header, with a contextual help (?) button, and gained their own live year filter -- matching the author pages\' layout and controls.',
    'Fixed a cross-check URL always carrying a "?from=&to=" year range, even with no filter active.',
    'Open tabs now show a small dblp/HAL icon, so different tab types are easier to tell apart at a glance.',
  ] },
  { version: '0.22', items: [
    'Cross-check pages (author/team/structure) now show a "Showing X of Y records" summary, and gained the same sort and match-confidence filter as the author pages.',
    'Added a "Not claimed on HAL" section: a DBLP record that looks missing but is already deposited under a different/unlinked HAL identity (found via DOI/arXiv id) is now called out separately, with what to do about it.',
  ] },
  { version: '0.21', items: [
    'The Publication categories filter now also applies to cross-check pages (author/team/structure), not just the author pages.',
  ] },
  { version: '0.20', items: [
    'The match-confidence filter now shows a count next to each option (e.g. "Approximate match (12)").',
  ] },
  { version: '0.19', items: [
    'Replaced "Only show matches to review" with a full match-confidence filter (exact/approximate/ambiguous/manual/community/custom-ranking/no-match), right next to the year filter.',
    'Rank badges now show a small colored dot for match confidence instead of coloring the rank itself, with a hover tooltip explaining it.',
    'Fixed inconsistent colors in the yearly chart: CORE\'s "Misc" and grade colors, and "Unranked" now match between conferences and journals.',
    '"Informal and Other Publications" renamed to "Other Publications"; conference presentations with no published proceedings now belong there instead of "Conference paper".',
  ] },
  { version: '0.18', items: [
    'Fixed more HAL document types (journal issues, dissertations, various report kinds, etc.) that could still show a broken "NaN" tag.',
    'Team/structure member names in the publication list are now clickable, like any other author.',
  ] },
  { version: '0.17', items: [
    'HAL software deposits now get their own category (tag + color) instead of showing an incorrect "NaN" tag.',
  ] },
  { version: '0.16', items: [
    'Added a "Feedback & ideas" link to the About dialog.',
  ] },
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
