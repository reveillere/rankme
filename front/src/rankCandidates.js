// Backs the "change match" search in RankDetailsPopover: a few characters
// of a conference/journal name or acronym, resolved against the same
// yearly CORE/SJR edition the automatic match itself used.
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
