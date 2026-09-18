import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { applyLocalDecisions, DECISIONS_KEY, importLocalDecisions, importLocalLinks, LINKS_KEY, listCrosscheckDecisions, listIdentityLinks, personalDataFile, removeCrosscheckDecision, removeIdentityLink, reportPublicationKeys } from './personalData';
import { fetchIdentitySuggestion, fetchStructureIdentityResolution, postIdentityLink, deleteIdentityLink } from './identityResolution';
import { fetchStructureCrossCheck, fetchTeamCrossCheck, postCrossCheckOverride } from './crosscheck';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), clear: () => data.clear() };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const links = [{ idHal: 'alice', pid: '1/1' }, { idHal: 'bob', pid: '2/2' }];
const decision = { dblpKey: 'conf/test/paper', halDocid: '42', decision: 'same' };
function report() {
  return { results: [{ publication: { dblp: { key: decision.dblpKey } }, status: 'to-review', matches: [{ confidence: 'fuzzy', halPub: { docid: '42' } }] }] };
}

describe('personal identity links', () => {
  it('writes and deletes locally, without HTTP or server migration', async () => {
    await postIdentityLink(links[0]);
    expect(await fetchIdentitySuggestion('1/1')).toMatchObject({ ...links[0], source: 'local' });
    await deleteIdentityLink('alice');
    expect(listIdentityLinks()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shares one structure between two browsers and preserves unrelated links', () => {
    importLocalLinks([...links, { idHal: 'private', pid: '3/3' }]);
    const selected = listIdentityLinks({ idHals: ['alice', 'bob'] });
    const file = personalDataFile('identity-links', selected, { type: 'structure', id: 'lab' });
    vi.stubGlobal('localStorage', storage());
    importLocalLinks([{ idHal: 'colleague', pid: '4/4' }]);
    importLocalLinks(JSON.parse(JSON.stringify(file)), { idHals: ['alice', 'bob'] });
    expect(listIdentityLinks().map(link => link.idHal).sort()).toEqual(['alice', 'bob', 'colleague']);
    expect(listIdentityLinks({ pids: ['1/1'] })).toHaveLength(1);
  });
  it('validates the whole import before writing, including conflicts and scope', () => {
    importLocalLinks(links);
    const before = localStorage.getItem(LINKS_KEY);
    for (const invalid of [[{ idHal: 'alice', pid: '9/9' }, null], [{ idHal: 'alice', pid: '9/9' }, { idHal: 'alice', pid: '8/8' }], [{ idHal: 'other', pid: '9/9' }]]) {
      expect(() => importLocalLinks(invalid, { idHals: ['alice'] })).toThrow();
      expect(localStorage.getItem(LINKS_KEY)).toBe(before);
    }
    expect(() => importLocalLinks([{ idHal: 'alice', pid: '2/2' }])).toThrow(/already linked/);
    importLocalLinks([{ idHal: 'alice', pid: '9/9' }]);
    expect(listIdentityLinks({ idHals: ['bob'] })[0].pid).toBe('2/2');
  });
  it('overlays local links on automatic suggestions and restores them after deletion', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [{ idHal: 'alice', resolved: { pid: 'auto', source: 'orcid' }, candidates: [] }] });
    importLocalLinks([links[0]]);
    expect((await fetchStructureIdentityResolution('lab'))[0].resolved).toEqual({ pid: '1/1', source: 'local' });
    removeIdentityLink('alice');
    expect((await fetchStructureIdentityResolution('lab'))[0].resolved.pid).toBe('auto');
  });
});

describe('personal cross-check decisions', () => {
  it('saves a decision without HTTP and undoes it without mutating the automatic report', async () => {
    const automatic = report();
    await postCrossCheckOverride(decision);
    expect(applyLocalDecisions(automatic).results[0].status).toBe('confirmed');
    expect(automatic.results[0].status).toBe('to-review');
    removeCrosscheckDecision(decision);
    expect(applyLocalDecisions(automatic).results[0].status).toBe('to-review');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('exports confirmed/rejected decisions by publication scope, merges imports and keeps other work', () => {
    importLocalDecisions([decision, { ...decision, dblpKey: 'other-paper', decision: 'different' }]);
    const file = personalDataFile('crosscheck-decisions', listCrosscheckDecisions(reportPublicationKeys(report())), { type: 'author', pid: '1/1' });
    expect(file.entries).toHaveLength(1);
    vi.stubGlobal('localStorage', storage());
    importLocalDecisions([{ ...decision, dblpKey: 'unrelated' }]);
    importLocalDecisions(file, reportPublicationKeys(report()));
    importLocalDecisions([{ ...decision, decision: 'different' }]);
    expect(listCrosscheckDecisions()).toHaveLength(2);
    expect(applyLocalDecisions(report()).results[0].status).toBe('missing');
  });
  it('rejects out-of-scope, malformed and contradictory files atomically', () => {
    importLocalDecisions([decision]);
    const before = localStorage.getItem(DECISIONS_KEY);
    for (const invalid of [[{ ...decision, decision: 'invalid' }], [{ ...decision, dblpKey: 'other' }], [decision, { ...decision, decision: 'different' }], { ...personalDataFile('identity-links', links), version: 2 }]) {
      expect(() => importLocalDecisions(invalid, [decision.dblpKey])).toThrow();
      expect(localStorage.getItem(DECISIONS_KEY)).toBe(before);
    }
  });
  it('updates structure/team counts and preserves remaining strong matches on rejection', () => {
    const result = report().results[0];
    result.matches.push({ confidence: 'strong', halPub: { docid: '43' } });
    const automatic = { members: [{ results: [result], confirmedCount: 0 }], confirmedCount: 0 };
    const applied = applyLocalDecisions(automatic, [{ ...decision, decision: 'different' }]);
    expect(applied.confirmedCount).toBe(1);
    expect(applied.members[0].confirmedCount).toBe(1);
    expect(automatic.confirmedCount).toBe(0);
  });
  it('surfaces storage failures instead of reporting a successful save', async () => {
    localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    await expect(postCrossCheckOverride(decision)).rejects.toThrow('Quota exceeded');
    expect(listCrosscheckDecisions()).toEqual([]);
  });
});

describe('request-specific links', () => {
  it('sends only the selected structure links and no personal decisions', async () => {
    importLocalLinks(links);
    importLocalDecisions([decision]);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ idHal: 'alice', resolved: null, candidates: [] }] });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => report() });
    await fetchStructureCrossCheck('lab');
    const [url, options] = fetch.mock.calls[1];
    expect(url).toBe('/api/internal/crosscheck/structure');
    expect(JSON.parse(options.body)).toEqual({ structId: 'lab', identityLinks: [{ ...links[0], source: 'local' }] });
  });
  it('sends only the selected team links, for either source', async () => {
    importLocalLinks(links);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ members: [] }) });
    for (const [source, pids] of [['hal', ['alice']], ['dblp', ['1/1']]]) {
      await fetchTeamCrossCheck({ source, pids });
      expect(JSON.parse(fetch.mock.lastCall[1].body).identityLinks).toEqual([{ ...links[0], source: 'local' }]);
    }
  });
});
