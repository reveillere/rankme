const STORAGE_KEY = 'rankme:matchOverrides';
const CLIENT_ID_KEY = 'rankme:clientId';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function write(overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // storage full/unavailable — overrides are best-effort, ignore
  }
}

// One override per (portal, ranking edition, exact input text) -- mirrors
// the server's own rank cache key, so a correction applies to exactly what
// produced the rank being corrected (and nothing else, e.g. a differently
// phrased edition of the same venue in another year).
function keyFor(portal, rankSource, queryText) {
  return `${portal}:${rankSource}:${queryText}`;
}

// A random per-browser id, kept only to tell "several different people hit
// this same mismatch" apart from "one person corrected it repeatedly" on
// the server-side copy -- not tied to any account or identity.
export function getClientId() {
  let id;
  try { id = localStorage.getItem(CLIENT_ID_KEY); } catch { /* unavailable */ }
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(CLIENT_ID_KEY, id); } catch { /* best-effort */ }
  }
  return id;
}

// rank: the structured rank object from the API (needs .source + .queryText).
export function getOverride(portal, rank) {
  if (!rank?.source || !rank?.queryText) return null;
  return read()[keyFor(portal, rank.source, rank.queryText)] || null;
}

export function listOverrides() {
  return Object.values(read()).sort((a, b) => b.savedAt - a.savedAt);
}

export function countOverrides() {
  return Object.keys(read()).length;
}

// Backfills candidate.currentSource/currentValue on an override saved
// before that data was attached to search results (or imported from a CSV
// that didn't have those columns) -- called once RankDetailsPopover has
// looked the values up live, so they don't need re-fetching every time the
// popover reopens.
export function patchOverrideCandidate(key, patch) {
  const overrides = read();
  if (!overrides[key]) return;
  overrides[key] = { ...overrides[key], candidate: { ...overrides[key].candidate, ...patch } };
  write(overrides);
  return overrides[key];
}

function previousMatchOf(rank) {
  return {
    matchType: rank.matchType,
    matchedTitle: rank.matchedTitle,
    matchedAcronym: rank.matchedAcronym ?? null,
    matchedId: rank.matchedId,
    value: rank.value,
  };
}

// Best-effort copy for later analysis of which venues keep getting
// mismatched (or, for a confirmation, which approximate matches are
// actually right) -- never blocks or fails the local change on network issues.
function postToServer({ portal, year, queryText, previous, candidate, action }) {
  fetch('/api/match-overrides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: portal, year: year ?? null, venueText: queryText,
      previousMatch: previous, newMatch: candidate, clientId: getClientId(), action,
    }),
  }).catch(() => { /* best-effort */ });
}

// candidate: { id, title, acronym?, value } -- one entry picked from the
// /api/rank/{core,sjr}/candidates search. year: the publication's own year,
// sent to the server copy for context (not part of the local override key).
export function setOverride({ portal, rank, year, candidate }) {
  const overrides = read();
  const key = keyFor(portal, rank.source, rank.queryText);
  const entry = {
    key, portal, type: 'override',
    rankSource: rank.source, queryText: rank.queryText, year: year ?? null,
    previous: previousMatchOf(rank),
    candidate,
    savedAt: Date.now(),
  };
  overrides[key] = entry;
  write(overrides);
  postToServer({ portal, year: entry.year, queryText: rank.queryText, previous: entry.previous, candidate, action: 'override' });
  return entry;
}

// Marks an existing approximate (fuzzy) automatic match as verified correct
// by the user, rather than replacing it with a different entry -- stored the
// same way an override is (same key, so getOverride finds either kind), but
// tagged 'confirmed' so the UI can show it distinctly (a lighter green,
// "Confirmed by you" instead of "Manually set by you").
export function confirmMatch({ portal, rank, year }) {
  const overrides = read();
  const key = keyFor(portal, rank.source, rank.queryText);
  const candidate = {
    id: rank.matchedId, title: rank.matchedTitle, acronym: rank.matchedAcronym ?? undefined, value: rank.value,
    currentSource: rank.currentSource, currentValue: rank.currentValue,
  };
  const entry = {
    key, portal, type: 'confirmed',
    rankSource: rank.source, queryText: rank.queryText, year: year ?? null,
    previous: previousMatchOf(rank),
    candidate,
    savedAt: Date.now(),
  };
  overrides[key] = entry;
  write(overrides);
  postToServer({ portal, year: entry.year, queryText: rank.queryText, previous: entry.previous, candidate, action: 'confirm' });
  return entry;
}

export function clearOverride(key) {
  const overrides = read();
  delete overrides[key];
  write(overrides);
}

export function clearAllOverrides() {
  write({});
}

const CSV_COLUMNS = [
  'portal', 'rankSource', 'queryText', 'year',
  'candidateId', 'candidateTitle', 'candidateAcronym', 'candidateValue', 'candidateCurrentSource', 'candidateCurrentValue',
  'previousMatchType', 'previousMatchedTitle', 'previousMatchedAcronym', 'previousMatchedId', 'previousValue',
  'savedAt',
];

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// venueText (queryText) routinely contains commas (e.g. "Journal of
// Software Testing, Verification and Reliability"), so every field is
// exported through proper RFC4180 quoting rather than a naive join(',').
export function overridesToCSV() {
  const rows = listOverrides().map(o => [
    o.portal, o.rankSource, o.queryText, o.year ?? '',
    o.candidate.id, o.candidate.title, o.candidate.acronym ?? '', o.candidate.value,
    o.candidate.currentSource ?? '', o.candidate.currentValue ?? '',
    o.previous?.matchType ?? '', o.previous?.matchedTitle ?? '', o.previous?.matchedAcronym ?? '', o.previous?.matchedId ?? '', o.previous?.value ?? '',
    o.savedAt,
  ]);
  const lines = [CSV_COLUMNS.join(','), ...rows.map(r => r.map(csvEscape).join(','))];
  return lines.join('\r\n');
}

// Minimal RFC4180 parser -- handles quoted fields with embedded commas,
// newlines, and escaped ("") quotes, which a plain split(',')/split('\n')
// would corrupt given queryText's free-text venue names.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Imported rows become local overrides only -- they're not re-posted to the
// server copy, since that copy is meant to reflect corrections made live by
// distinct users, not a rule set someone is replaying onto a new browser.
export function importOverridesFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return 0;
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['portal', 'rankSource', 'queryText', 'candidateId', 'candidateTitle', 'candidateValue'];
  const missing = required.filter(r => !(r in idx));
  if (missing.length > 0) throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);

  const overrides = read();
  let count = 0;
  for (const row of rows.slice(1)) {
    const get = (col) => (idx[col] != null ? row[idx[col]] : '');
    const portal = get('portal');
    const rankSource = get('rankSource');
    const queryText = get('queryText');
    const candidateId = get('candidateId');
    if (!portal || !rankSource || !queryText || !candidateId) continue;

    const key = keyFor(portal, rankSource, queryText);
    overrides[key] = {
      key, portal, rankSource, queryText,
      year: get('year') ? Number(get('year')) : null,
      previous: {
        matchType: get('previousMatchType') || null,
        matchedTitle: get('previousMatchedTitle') || null,
        matchedAcronym: get('previousMatchedAcronym') || null,
        matchedId: get('previousMatchedId') || null,
        value: get('previousValue') || null,
      },
      candidate: {
        id: candidateId,
        title: get('candidateTitle'),
        acronym: get('candidateAcronym') || undefined,
        value: get('candidateValue'),
        currentSource: get('candidateCurrentSource') || undefined,
        currentValue: get('candidateCurrentValue') || undefined,
      },
      savedAt: get('savedAt') ? Number(get('savedAt')) : Date.now(),
    };
    count++;
  }
  write(overrides);
  return count;
}
