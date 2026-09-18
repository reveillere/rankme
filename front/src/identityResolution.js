import { listIdentityLinks, importLocalLinks, removeIdentityLink } from './personalData';

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || `Identity resolution: HTTP ${response.status}`);
  return body;
}

export async function fetchIdentitySuggestion(pid) {
  const local = listIdentityLinks({ pids: [pid] })[0];
  return local || getJson(`/api/identity/suggest/${pid}`);
}

export async function fetchIdentitySuggestionForIdHal(idHal) {
  const local = listIdentityLinks({ idHals: [idHal] })[0];
  return local || getJson(`/api/identity/suggest-dblp/${encodeURIComponent(idHal)}`);
}

// Apply personal choices only in this browser. Automatic suggestions remain
// available when a local choice is removed.
function applyLinks(members, source) {
  const links = listIdentityLinks();
  return members.map(member => {
    const local = links.find(link => source === 'hal' ? link.idHal === member.idHal : link.pid === member.pid);
    if (!local) return member;
    return { ...member, confidence: 'confirmed', resolved: source === 'hal'
      ? { pid: local.pid, source: 'local' } : { idHal: local.idHal, source: 'local' } };
  });
}

export async function fetchStructureIdentityResolution(structId) {
  return applyLinks(await getJson(`/api/identity/structure/${encodeURIComponent(structId)}`), 'hal');
}

export async function fetchTeamIdentityResolution({ source, members }) {
  return applyLinks(await getJson('/api/identity/team', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, members }),
  }), source);
}

export async function postIdentityLink(link) {
  return importLocalLinks([link]);
}

export async function fetchIdentityLinks(scope) {
  return listIdentityLinks(scope);
}

export async function deleteIdentityLink(idHal) {
  removeIdentityLink(idHal);
}

export async function importIdentityLinks(links, scope) {
  return importLocalLinks(links, scope);
}
