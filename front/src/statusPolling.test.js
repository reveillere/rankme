import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startStatusPolling } from './statusPolling';
import { fetchStatus } from './dblp';

let stop;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function page() {
    const target = new EventTarget();
    target.hidden = false;
    target.show = visible => {
        target.hidden = !visible;
        target.dispatchEvent(new Event('visibilitychange'));
    };
    return target;
}

it('polls only while visible, refreshes on return and stops on cleanup', async () => {
    const doc = page();
    const fetch = vi.fn().mockResolvedValue({ ready: true });
    stop = startStatusPolling(fetch, vi.fn(), doc);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(2);
    doc.show(false);
    await vi.advanceTimersByTimeAsync(90000);
    expect(fetch).toHaveBeenCalledTimes(2);
    doc.show(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    stop();
    doc.show(false);
    doc.show(true);
    await vi.advanceTimersByTimeAsync(90000);
    expect(fetch).toHaveBeenCalledTimes(3);
});

it('does not overlap requests and discards an aborted response after hiding', async () => {
    const doc = page();
    let resolve;
    const fetch = vi.fn(() => new Promise(r => { resolve = r; }));
    const update = vi.fn();
    stop = startStatusPolling(fetch, update, doc);
    await vi.advanceTimersByTimeAsync(6000);
    doc.show(false);
    doc.show(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve({ ready: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('backs off after errors and resumes five-second polling while importing', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error()).mockRejectedValueOnce(new Error()).mockResolvedValue({ ready: false });
    stop = startStatusPolling(fetch, vi.fn(), page());
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(4);
});

it('aborts a stalled request after ten seconds and retries', async () => {
    const fetch = vi.fn(({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    stop = startStatusPolling(fetch, vi.fn(), page());
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch.mock.calls[0][0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('HTTP errors trigger polling backoff instead of masquerading as a DBLP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchStatus()).rejects.toThrow('HTTP 503');
});
