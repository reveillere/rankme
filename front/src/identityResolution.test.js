import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let fetchIdentityLinkMembers, identityLinkFromMember, postIdentityLink, deleteIdentityLink, clearIdentityLinks;
import { listIdentityLinks } from './personalData';

beforeEach(async () => {
  vi.resetModules();
  ({ fetchIdentityLinkMembers, identityLinkFromMember, postIdentityLink, deleteIdentityLink, clearIdentityLinks } = await import('./identityResolution'));
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared identity-links members', () => {
  it.each([
    { source: 'dblp', members: [{ id: '1/1', name: 'Alice' }] },
    { structId: 'lab', source: 'hal' },
  ])('shares concurrent requests and reuses automatic results on reopening (%j)', async selection => {
    let finish;
    fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = fetchIdentityLinkMembers(selection);
    const second = fetchIdentityLinkMembers(selection);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish({ ok: true, json: async () => [] });
    await Promise.all([first, second]);
    await fetchIdentityLinkMembers(selection);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('expires automatic results and separates selections', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    fetch.mockResolvedValue({ ok: true, json: async () => [] });
    const selection = { source: 'dblp', members: [{ id: '1/1', name: 'Alice' }] };
    await fetchIdentityLinkMembers(selection);
    await fetchIdentityLinkMembers({ ...selection, members: [{ id: '2/2', name: 'Bob' }] });
    await fetchIdentityLinkMembers({ source: 'hal', members: [{ id: 'alice', name: 'Alice' }] });
    expect(fetch).toHaveBeenCalledTimes(3);
    now.mockReturnValue(1000 + 5 * 60 * 1000);
    await fetchIdentityLinkMembers(selection);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('reports Retry-After and allows retrying a failed request instead of caching the error', async () => {
    const selection = { source: 'dblp', members: [{ id: '1/1' }] };
    fetch.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '12' }), json: async () => ({ error: 'Too Many Requests' }) });
    await expect(fetchIdentityLinkMembers(selection)).rejects.toThrow('try again in 12 seconds');
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await fetchIdentityLinkMembers(selection)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['dblp', 'hal'])('resolves a single %s author, saves a candidate and restores suggestions after deletion', async source => {
    const inverse = source === 'dblp';
    const member = { [inverse ? 'pid' : 'idHal']: inverse ? '1/1' : 'alice', name: 'Alice', resolved: null,
      candidates: [{ [inverse ? 'idHal' : 'pid']: inverse ? 'alice' : '1/1', name: 'Alice Example' }] };
    fetch.mockResolvedValue({ ok: true, json: async () => [member] });
    const selection = { source, members: [{ id: inverse ? '1/1' : 'alice', name: 'Alice' }] };
    expect(await fetchIdentityLinkMembers(selection)).toEqual([member]);
    expect(fetch).toHaveBeenLastCalledWith('/api/identity/team', expect.objectContaining({ body: JSON.stringify(selection) }));
    expect(identityLinkFromMember(member, source)).toBeNull();

    await postIdentityLink({ idHal: 'alice', pid: '1/1' });
    const [confirmed] = await fetchIdentityLinkMembers(selection);
    expect(identityLinkFromMember(confirmed, source)).toMatchObject({ idHal: 'alice', pid: '1/1', source: 'local' });
    expect(confirmed.name).toBe('Alice');

    await deleteIdentityLink('alice');
    expect(await fetchIdentityLinkMembers(selection)).toEqual([member]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the same model for structure suggestions and local links', async () => {
    const automatic = { idHal: 'alice', name: 'Alice HAL', resolved: { pid: '1/1', name: 'Alice DBLP', source: 'orcid' }, candidates: [] };
    fetch.mockResolvedValue({ ok: true, json: async () => [automatic] });
    const [member] = await fetchIdentityLinkMembers({ structId: 'lab', source: 'hal' });
    expect(fetch).toHaveBeenCalledWith('/api/identity/structure/lab', undefined);
    const link = identityLinkFromMember(member, 'hal');
    expect(link).toEqual({ idHal: 'alice', pid: '1/1', name: 'Alice HAL', dblpName: 'Alice DBLP', source: 'orcid' });
    await postIdentityLink(link);
    fetch.mockClear();
    const personal = await fetchIdentityLinkMembers({ all: true });
    expect(personal.map(member => identityLinkFromMember(member, 'dblp'))).toEqual([
      expect.objectContaining({ idHal: 'alice', pid: '1/1', source: 'local' }),
    ]);
    expect(fetch).toHaveBeenCalledWith('/api/identity/team', expect.objectContaining({
      body: JSON.stringify({ source: 'dblp', members: [{ id: '1/1' }] }),
    }));
  });

  it.each([{ idHals: ['alice', 'bob'] }, { pids: ['1/1', '2/2'] }])('clears only the selected personal links (%j)', async scope => {
    await postIdentityLink({ idHal: 'alice', pid: '1/1' });
    await postIdentityLink({ idHal: 'bob', pid: '2/2' });
    await postIdentityLink({ idHal: 'other', pid: '3/3' });
    await clearIdentityLinks(scope);
    expect(listIdentityLinks()).toEqual([{ idHal: 'other', pid: '3/3', source: 'local' }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps links for an empty selection and clears all from the personal-links view', async () => {
    await postIdentityLink({ idHal: 'alice', pid: '1/1' });
    await clearIdentityLinks({ idHals: [] });
    expect(listIdentityLinks()).toHaveLength(1);
    await clearIdentityLinks();
    expect(listIdentityLinks()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
