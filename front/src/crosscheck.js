import { rankingQueryParams } from './rankingSource';
import { getClientId } from './matchOverrides';
import { apiTokenHeaders } from './apiToken';

// Author-scope, DBLP -> HAL crosscheck (see api/src/crosscheck.js): which of
// this DBLP author's publications have no corresponding HAL deposit. Ranking
// source (CORE/SJR vs CCF, per axis) is threaded through the same way every
// other streaming endpoint does (see Author.js) -- the server needs it to
// compute a rank for each still-missing/to-review publication (see
// authorStream.js's computeDblpPublicationRank).
export async function fetchCrossCheck(pid, halId, { conferenceSource, journalSource } = {}) {
  // rankingQueryParams returns either '' or a leading-'?' string -- this
  // endpoint's own halId param is already in the query string, so a
  // non-empty result gets appended with '&' instead of a second '?'.
  const rankingParams = rankingQueryParams({ conferenceSource, journalSource }).replace(/^\?/, '&');
  const resp = await fetch(`/api/crosscheck/author/${pid}?halId=${encodeURIComponent(halId)}${rankingParams}`, { headers: apiTokenHeaders() });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Cross-check: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// Team-scope, DBLP -> HAL crosscheck (see api/src/crosscheckTeam.js): pids
// travels in the POST body, not a query string, since a team's member list
// (front/src/teamStore.js) can be long -- unlike fetchCrossCheck above,
// there's no single halId to resolve here, each pid is resolved to a HAL
// identity individually, server-side.
export async function fetchTeamCrossCheck({ source, pids }, { conferenceSource, journalSource } = {}) {
  const rankingParams = rankingQueryParams({ conferenceSource, journalSource });
  const resp = await fetch(`/api/internal/crosscheck/team${rankingParams}`, {
    method: 'POST',
    headers: apiTokenHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ source, pids }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Team cross-check: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// Structure-scope, DBLP -> HAL crosscheck (see api/src/crosscheckStructure.js):
// unlike fetchTeamCrossCheck above, a HAL structure has a stable server-side
// structId (identityResolution.js already resolves its whole membership by
// name/orcid), so this is a plain GET, same shape as fetchCrossCheck's own
// single-pid request, just keyed by structId instead of (pid, halId).
export async function fetchStructureCrossCheck(structId, { conferenceSource, journalSource } = {}) {
  const rankingParams = rankingQueryParams({ conferenceSource, journalSource });
  const resp = await fetch(`/api/crosscheck/structure/${structId}${rankingParams}`, { headers: apiTokenHeaders() });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Structure cross-check: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// A maintainer confirming/rejecting one specific (dblp publication, HAL
// candidate) pair shown under "To review" -- see api/src/crosscheckOverrides.js.
// Best-effort like matchOverrides.js's own postToServer isn't: the caller
// (CrossCheck.js) needs to know the write actually landed before it
// refetches the report, or a failed request would look like a no-op click.
export async function postCrossCheckOverride({ dblpKey, halDocid, decision }) {
  const resp = await fetch('/api/crosscheck/override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dblpKey, halDocid, decision, clientId: getClientId() }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Cross-check override: HTTP ${resp.status}`);
  }
}
