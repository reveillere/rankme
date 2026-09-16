// { idHal, name?, source } | { idHal: null } -- see
// api/src/identityResolution.js's controllerSuggestIdentity for the
// personLinks-first, then-ORCID resolution order.
export async function fetchIdentitySuggestion(pid) {
  const resp = await fetch(`/api/identity/suggest/${pid}`);
  return await resp.json();
}

// Reverse sibling of fetchIdentitySuggestion above, for AuthorHal.js's own
// "Cross-check with DBLP" button -- { pid, name?, source } | { pid: null },
// see api/src/identityResolution.js's controllerSuggestDblpIdentity. A plain
// :idHal route param (no wildcard needed, unlike suggest/:pid -- an idHal
// never contains a slash).
export async function fetchIdentitySuggestionForIdHal(idHal) {
  const resp = await fetch(`/api/identity/suggest-dblp/${idHal}`);
  return await resp.json();
}

// The structure-level resolver returns both confirmed links and the DBLP
// candidates still awaiting a human decision.  IdentityLinksPanel uses this
// for the structure's link-management dialog, so it presents the exact same
// candidates as the structure cross-check page.
export async function fetchStructureIdentityResolution(structId) {
  const resp = await fetch(`/api/identity/structure/${encodeURIComponent(structId)}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Structure identity resolution: HTTP ${resp.status}`);
  }
  return await resp.json();
}

export async function fetchTeamIdentityResolution({ source, members }) {
  const resp = await fetch('/api/identity/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, members }) });
  if (!resp.ok) throw new Error(`Team identity resolution: HTTP ${resp.status}`);
  return await resp.json();
}

// Records a confirmed (idHal, pid) pair -- see api/src/identityResolution.js's
// controllerRecordLink. Always writes source 'manual' server-side, regardless
// of whether the confirmed idHal came from a fresh search or an accepted
// suggestion.
export async function postIdentityLink({ idHal, pid }) {
  const resp = await fetch('/api/identity/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idHal, pid }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Identity link: HTTP ${resp.status}`);
  }
}

// Direct management of personLinks (IdentityLinksPanel.js), independent of
// the cross-check flow above -- lists every link already on file for a
// given team/structure's own member ids, from either side (a dblp-sourced
// team only has pids to search by, a hal-sourced one/a structure only has
// idHals -- see api/src/identityResolution.js's controllerListLinks for why
// both params are accepted and merged). idHals/pids are plain arrays here;
// the comma-joining is this function's own concern, not every caller's.
export async function fetchIdentityLinks({ idHals = [], pids = [] } = {}) {
  const params = new URLSearchParams();
  if (idHals.length > 0) params.set('idHals', idHals.join(','));
  if (pids.length > 0) params.set('pids', pids.join(','));
  const resp = await fetch(`/api/identity/links?${params}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Fetch identity links: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// Deletes the link on file for one idHal -- see
// api/src/identityResolution.js's controllerDeleteLink. idHal alone is
// enough: it's personLinks' own unique key.
export async function deleteIdentityLink(idHal) {
  const resp = await fetch('/api/identity/link', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idHal }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Delete identity link: HTTP ${resp.status}`);
  }
}

// Bulk sibling of postIdentityLink above, for IdentityLinksPanel.js's own
// file-import button -- see api/src/identityResolution.js's
// controllerImportLinks. Returns {imported, skipped} rather than throwing on
// a partially-invalid file: the server already tolerates a batch with a few
// bad rows, so the caller can report the counts instead of an all-or-nothing
// failure.
export async function importIdentityLinks(links) {
  const resp = await fetch('/api/identity/links/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Import identity links: HTTP ${resp.status}`);
  }
  return await resp.json();
}
