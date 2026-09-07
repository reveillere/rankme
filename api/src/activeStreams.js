// Tracks in-flight ranking SSE sessions (one per open author/team-stream
// browser connection) for the admin dashboard — answers "how many ranking
// requests are pending right now", which the per-job Bottleneck counts in
// ranking.js/throttler.js don't directly show.
const active = new Map();
let nextId = 1;

export function register(label) {
  const id = nextId++;
  active.set(id, { label, startedAt: Date.now(), completed: 0, total: 0 });
  return id;
}

export function updateProgress(id, completed, total) {
  const entry = active.get(id);
  if (entry) {
    entry.completed = completed;
    entry.total = total;
  }
}

export function unregister(id) {
  active.delete(id);
}

export function list() {
  const now = Date.now();
  return [...active.values()]
    .map(e => ({ ...e, elapsedMs: now - e.startedAt }))
    .sort((a, b) => b.elapsedMs - a.elapsedMs);
}
