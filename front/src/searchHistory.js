const STORAGE_KEY = 'rankme:searchHistory';
const MAX_ENTRIES = 20;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full/unavailable — history is best-effort, ignore
  }
}

export function getSearchHistory() {
  return read();
}

// Records an opened author/team, most-recent first, deduplicated by id and
// capped at MAX_ENTRIES. Called from App.js's openAuthorTab, the single
// choke point every author/team open already funnels through.
export function recordSearchHistory(entry) {
  const existing = read().filter(e => e.id !== entry.id);
  const next = [{ ...entry, openedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
  write(next);
  return next;
}

export function clearSearchHistory() {
  write([]);
}
