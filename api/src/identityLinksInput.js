// Per-request identity links are intentionally not persisted. They allow an
// API caller to supply an exported Identity links JSON file for one
// cross-check without changing the application's shared links.
export class IdentityLinksConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdentityLinksConflictError';
  }
}

export function parseIdentityLinks(input) {
  if (input === undefined || input === null) return null;
  let links = input;
  if (typeof links === 'string') {
    try { links = JSON.parse(links); } catch { throw new IdentityLinksConflictError('identityLinks must contain valid JSON'); }
  }
  if (links?.format === 'rankme-personal-data') {
    if (links.version !== 1 || links.kind !== 'identity-links') throw new IdentityLinksConflictError('Expected an identity-links file (version 1)');
    links = links.entries;
  }
  if (!Array.isArray(links)) throw new IdentityLinksConflictError('identityLinks must be an array of { idHal, pid } links');

  const byIdHal = new Map();
  const byPid = new Map();
  for (const link of links) {
    const idHal = typeof link?.idHal === 'string' ? link.idHal.trim() : '';
    const pid = typeof link?.pid === 'string' ? link.pid.trim() : '';
    if (!idHal || !pid) throw new IdentityLinksConflictError('Each identity link requires non-empty idHal and pid');
    if ((byIdHal.has(idHal) && byIdHal.get(idHal) !== pid) || (byPid.has(pid) && byPid.get(pid) !== idHal)) {
      throw new IdentityLinksConflictError(`Conflicting identity links for idHal ${idHal} or pid ${pid}`);
    }
    byIdHal.set(idHal, pid);
    byPid.set(pid, idHal);
  }
  return { byIdHal, byPid };
}

export function assertIdentityPairIsCompatible(identityLinks, { idHal, pid }) {
  if (!identityLinks) return;
  const suppliedPid = identityLinks.byIdHal.get(idHal);
  const suppliedIdHal = identityLinks.byPid.get(pid);
  if ((suppliedPid && suppliedPid !== pid) || (suppliedIdHal && suppliedIdHal !== idHal)) {
    throw new IdentityLinksConflictError(`The supplied identity links do not match ${idHal} and ${pid}`);
  }
}
