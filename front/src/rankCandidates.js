// Backs the "change match" search in RankDetailsPopover: a few characters
// of a conference/journal name or acronym, resolved against the same
// edition the automatic match itself used -- the yearly CORE/SJR edition
// for those two portals, or CCF's one single list (year is still sent for
// portal 'ccf', but the backend ignores it -- see ccfPortal.js's
// controllerCandidates).
export async function searchCandidates(portal, year, query) {
  const trimmed = (query || '').trim();
  if (!year || trimmed.length < 2) return [];
  try {
    const resp = await fetch(`/api/rank/${portal}/candidates?year=${encodeURIComponent(year)}&q=${encodeURIComponent(trimmed)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}
