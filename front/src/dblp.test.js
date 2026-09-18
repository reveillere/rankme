import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthor } from './dblp';

const author = { dblpperson: { $: { name: 'Laurent Réveillère' } } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pendingRequest(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

describe('DBLP author loading', () => {
  it('returns a valid author and cleans up the timeout', async () => {
    fetch.mockResolvedValue(response(author));
    await expect(fetchAuthor('11/1262')).resolves.toEqual(author);
    expect(fetch).toHaveBeenCalledWith('/api/dblp/author/11/1262', { signal: expect.any(AbortSignal) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an HTML proxy error and permits a successful retry', async () => {
    fetch.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    fetch.mockResolvedValueOnce(response(author));
    await expect(fetchAuthor('11/1262')).rejects.toThrow('HTTP 502');
    await expect(fetchAuthor('11/1262')).resolves.toEqual(author);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes an unknown author', async () => {
    fetch.mockResolvedValue(response({ error: 'Not found' }, 404));
    await expect(fetchAuthor('missing')).rejects.toThrow('No DBLP author found');
  });

  it('explains when the local DBLP dump is unavailable', async () => {
    fetch.mockResolvedValue(response({ error: 'DBLP local dump is importing' }, 503));
    await expect(fetchAuthor('11/1262')).rejects.toThrow('DBLP local dump is importing');
  });

  it.each([{}, { dblpperson: { $: { name: '' } } }, null])('rejects invalid successful payloads: %j', async body => {
    fetch.mockResolvedValue(response(body));
    await expect(fetchAuthor('11/1262')).rejects.toThrow('invalid author response');
  });

  it('explains a network failure', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchAuthor('11/1262')).rejects.toThrow('Cannot reach the RankMe API');
  });

  it('aborts a stalled request after 15 seconds', async () => {
    fetch.mockImplementation((url, { signal }) => pendingRequest(signal));
    const assertion = expect(fetchAuthor('11/1262')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also times out when the response body stalls', async () => {
    fetch.mockImplementation(async (url, { signal }) => ({ ok: true, json: () => pendingRequest(signal) }));
    const assertion = expect(fetchAuthor('11/1262')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('preserves caller cancellation and removes its timeout', async () => {
    fetch.mockImplementation((url, { signal }) => pendingRequest(signal));
    const controller = new AbortController();
    const assertion = expect(fetchAuthor('11/1262', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
