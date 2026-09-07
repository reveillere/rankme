const STORAGE_KEY = 'rankme:teams';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(teams) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
  } catch {
    // storage full/unavailable — teams are client-only for now, best-effort
  }
}

export function getTeams() {
  return read();
}

// source: 'dblp' | 'hal' (one source per team — DBLP and HAL ids don't
// overlap, so members are homogeneous). members: [{ id, label }]
export function createTeam(name, source, members) {
  const team = { id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, source, members };
  write([...read(), team]);
  return team;
}

export function deleteTeam(id) {
  write(read().filter(t => t.id !== id));
}

export function updateTeam(id, updates) {
  write(read().map(t => (t.id === id ? { ...t, ...updates } : t)));
}

export function getTeam(id) {
  return read().find(t => t.id === id) || null;
}
