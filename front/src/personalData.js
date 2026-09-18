// Personal choices never leave this browser except in an explicit file export
// or as request-specific identity links needed to compute a report.
export const LINKS_KEY = 'rankme:identityLinks';
export const DECISIONS_KEY = 'rankme:crosscheckDecisions';
export const PERSONAL_DATA_EVENT = 'rankme:personaldatachange';

function read(key) {
  const value = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(value)) throw new Error('Invalid personal data in this browser. Export a backup before resetting it.');
  return value;
}

function write(key, value) {
  // Surface quota/privacy-mode errors: never claim a choice was saved when
  // it only existed in memory.
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(PERSONAL_DATA_EVENT, { detail: { key } }));
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error(`Invalid ${field}`);
  return value.trim();
}

export function fileEntries(input, kind) {
  if (Array.isArray(input)) return input; // legacy links exports
  if (input?.format !== 'rankme-personal-data' || input.version !== 1 || input.kind !== kind || !Array.isArray(input.entries)) {
    throw new Error(`Expected a RankMe ${kind} file (version 1).`);
  }
  return input.entries;
}

export function personalDataFile(kind, entries, scope) {
  return { format: 'rankme-personal-data', version: 1, kind, scope, entries };
}

export function listIdentityLinks({ idHals, pids } = {}) {
  const links = read(LINKS_KEY);
  if (idHals === undefined && pids === undefined) return links;
  return links.filter(link => idHals?.includes(link.idHal) || pids?.includes(link.pid));
}

export function importLocalLinks(input, scope) {
  const entries = fileEntries(input, 'identity-links').map(entry => ({
    idHal: text(entry?.idHal, 'idHal'), pid: text(entry?.pid, 'pid'), source: 'local',
  }));
  const byHal = new Map();
  const byPid = new Map();
  for (const entry of entries) {
    if (scope && !scope.idHals?.includes(entry.idHal) && !scope.pids?.includes(entry.pid)) throw new Error('This file contains links outside the current author, structure or team. Import it from My identity links instead.');
    if ((byHal.has(entry.idHal) && byHal.get(entry.idHal) !== entry.pid) || (byPid.has(entry.pid) && byPid.get(entry.pid) !== entry.idHal)) throw new Error('Conflicting identities in this file. No links were imported.');
    byHal.set(entry.idHal, entry.pid);
    byPid.set(entry.pid, entry.idHal);
  }
  const existing = read(LINKS_KEY);
  // Replacing a selected HAL identity is intentional. Do not silently steal
  // another HAL identity's PID, especially one outside the imported scope.
  const retained = existing.filter(link => !byHal.has(link.idHal));
  if (retained.some(link => byPid.has(link.pid) && byPid.get(link.pid) !== link.idHal)) throw new Error('A PID is already linked to another HAL identity. Delete that local link first.');
  const unique = [...byHal].map(([idHal, pid]) => ({ idHal, pid, source: 'local' }));
  write(LINKS_KEY, [...retained, ...unique]);
  return { imported: unique.length };
}

export function removeIdentityLink(idHal) {
  write(LINKS_KEY, read(LINKS_KEY).filter(link => link.idHal !== idHal));
}

export function listCrosscheckDecisions(dblpKeys) {
  const entries = read(DECISIONS_KEY);
  return dblpKeys === undefined ? entries : entries.filter(entry => dblpKeys.includes(entry.dblpKey));
}

const decisionKey = entry => JSON.stringify([entry.dblpKey, entry.halDocid]);

export function importLocalDecisions(input, dblpKeys) {
  const entries = fileEntries(input, 'crosscheck-decisions').map(entry => {
    const result = { dblpKey: text(entry?.dblpKey, 'dblpKey'), halDocid: text(entry?.halDocid, 'halDocid'), decision: entry?.decision };
    if (!['same', 'different'].includes(result.decision)) throw new Error('A decision must be same or different.');
    if (dblpKeys && !dblpKeys.includes(result.dblpKey)) throw new Error('This file contains decisions outside the current report. Check its author/structure, or import it from My cross-check decisions.');
    return result;
  });
  const incoming = new Map();
  for (const entry of entries) {
    const key = decisionKey(entry);
    if (incoming.has(key) && incoming.get(key).decision !== entry.decision) throw new Error('Conflicting decisions in this file. Nothing was imported.');
    incoming.set(key, entry);
  }
  const merged = new Map(read(DECISIONS_KEY).map(entry => [decisionKey(entry), entry]));
  for (const [key, entry] of incoming) merged.set(key, entry);
  write(DECISIONS_KEY, [...merged.values()]);
  return { imported: incoming.size };
}

export function removeCrosscheckDecision(entry) {
  write(DECISIONS_KEY, read(DECISIONS_KEY).filter(value => decisionKey(value) !== decisionKey(entry)));
}

export function applyLocalDecisions(report, decisions = listCrosscheckDecisions()) {
  const byPair = new Map(decisions.map(entry => [decisionKey(entry), entry.decision]));
  const applyResults = results => results.map(result => {
    const keyFor = match => decisionKey({ dblpKey: result.publication.dblp.key, halDocid: String(match.halPub.docid) });
    if (!result.matches.some(match => byPair.has(keyFor(match)))) return result;
    const kept = result.matches.filter(match => byPair.get(keyFor(match)) !== 'different');
    const confirmed = kept.filter(match => byPair.get(keyFor(match)) === 'same');
    const matches = confirmed.length ? confirmed : kept;
    const status = confirmed.length || matches.some(match => ['exact', 'strong'].includes(match.confidence))
      ? 'confirmed' : matches.length ? 'to-review' : 'missing';
    return { ...result, matches, status };
  });
  if (report.members) {
    const members = report.members.map(member => {
      const results = applyResults(member.results);
      return { ...member, results, confirmedCount: results.filter(result => result.status === 'confirmed').length };
    });
    return { ...report, members, confirmedCount: members.reduce((sum, member) => sum + member.confirmedCount, 0) };
  }
  return { ...report, results: applyResults(report.results) };
}

export function reportPublicationKeys(report) {
  return [...new Set((report.members ? report.members.flatMap(member => member.results) : report.results).map(result => result.publication.dblp.key))];
}
