import { rankingQueryParams } from './rankingSource';
import { fetchStructureIdentityResolution } from './identityResolution';
import { importLocalDecisions, listIdentityLinks } from './personalData';

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
  const resp = await fetch(`/api/crosscheck/author/${pid}?halId=${encodeURIComponent(halId)}${rankingParams}`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, pids, identityLinks: listIdentityLinks(source === 'hal' ? { idHals: pids } : { pids }) }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Team cross-check: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// Load membership before sending only this structure's local links. The
// browser POST route accepts them for this calculation without persisting them.
export async function fetchStructureCrossCheck(structId, { conferenceSource, journalSource } = {}) {
  const members = await fetchStructureIdentityResolution(structId);
  const identityLinks = listIdentityLinks({ idHals: members.map(member => member.idHal) });
  const rankingParams = rankingQueryParams({ conferenceSource, journalSource });
  const resp = await fetch(`/api/internal/crosscheck/structure${rankingParams}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structId, identityLinks }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Structure cross-check: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// Decisions apply to this browser only; the API always returns automatic matches.
export async function postCrossCheckOverride(entry) {
  return importLocalDecisions([{ ...entry, halDocid: String(entry.halDocid) }]);
}
