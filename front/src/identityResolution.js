import { listIdentityLinks, importLocalLinks, removeIdentityLink, removeIdentityLinks } from './personalData';

const RESOLUTION_TTL_MS = 5 * 60 * 1000;
const automaticResolutions = new Map();
const pendingResolutions = new Map();

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (response.status === 429) {
    const seconds = Number(response.headers?.get('Retry-After'));
    throw new Error(seconds > 0
      ? `Too many requests. Please try again in ${seconds} seconds.`
      : 'Too many requests. Please wait a moment before trying again.');
  }
  if (!response.ok) throw new Error(body.message || body.error || `Identity resolution: HTTP ${response.status}`);
  return body;
}

// Cache automatic suggestions only. Personal edits are overlaid after every
// read, so confirming, deleting or importing links never invalidates this cache.
// Share pending requests too: the panel can remount when its report finishes.
function getAutomaticResolution(url, options) {
  const key = JSON.stringify([url, options?.body]);
  const cached = automaticResolutions.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.members);
  automaticResolutions.delete(key);
  if (pendingResolutions.has(key)) return pendingResolutions.get(key);
  const request = getJson(url, options).then(members => {
    if (automaticResolutions.size >= 50) automaticResolutions.delete(automaticResolutions.keys().next().value);
    automaticResolutions.set(key, { members, expiresAt: Date.now() + RESOLUTION_TTL_MS });
    return members;
  }).finally(() => pendingResolutions.delete(key));
  pendingResolutions.set(key, request);
  return request;
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
  return applyLinks(await getAutomaticResolution(`/api/identity/structure/${encodeURIComponent(structId)}`), 'hal');
}

export async function fetchTeamIdentityResolution({ source, members }) {
  return applyLinks(await getAutomaticResolution('/api/identity/team', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, members }),
  }), source);
}

// Every identity-links view consumes the same member/resolved/candidates shape.
// A single author is just a selection containing one member.
export async function fetchIdentityLinkMembers({ all = false, structId, source = 'dblp', members }) {
  if (all) {
    const links = listIdentityLinks();
    if (!links.length) return [];
    // Resolve all saved DBLP ids in one request so the global panel can show
    // names for old links as well as newly created ones.
    const resolved = await fetchTeamIdentityResolution({
      source: 'dblp',
      members: links.map(link => ({ id: link.pid })),
    });
    return resolved.map((member, index) => {
      const link = links[index];
      return {
        ...member,
        pid: link.pid,
        name: member.name || link.dblpName,
        resolved: { idHal: link.idHal, name: member.resolved?.name, source: link.source },
      };
    });
  }
  if (structId) return fetchStructureIdentityResolution(structId);
  return fetchTeamIdentityResolution({ source, members });
}

export function identityLinkFromMember(member, source) {
  if (!member.resolved) return null;
  const inverse = source === 'dblp';
  return {
    idHal: inverse ? member.resolved.idHal : member.idHal,
    pid: inverse ? member.pid : member.resolved.pid,
    source: member.resolved.source,
    name: inverse ? member.resolved.name : member.name,
    dblpName: inverse ? member.name : member.resolved.name,
  };
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

export async function clearIdentityLinks(scope) {
  removeIdentityLinks(scope);
}

export async function importIdentityLinks(links, scope) {
  return importLocalLinks(links, scope);
}
