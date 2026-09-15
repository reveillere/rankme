// One request at a time, only while the browser document is visible.
export function startStatusPolling(fetchStatus, onStatus, page = document) {
    let stopped = false;
    let timer;
    let controller;
    let refresh = false;
    let failures = 0;

    async function poll() {
        if (stopped || page.hidden || controller) return;
        refresh = false;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 10000);
        let delay = 30000;
        try {
            const status = await fetchStatus({ signal: controller.signal });
            if (!stopped && !page.hidden && !controller.signal.aborted) onStatus(status);
            failures = 0;
            delay = status.ready ? 30000 : 5000;
        } catch {
            failures = Math.min(failures + 1, 5);
            delay = Math.min(5000 * 2 ** (failures - 1), 60000);
        } finally {
            clearTimeout(timeout);
            controller = undefined;
            if (!stopped && !page.hidden) timer = setTimeout(poll, refresh ? 0 : delay);
        }
    }

    function visibilityChanged() {
        clearTimeout(timer);
        refresh = true;
        if (page.hidden) controller?.abort();
        else poll();
    }

    page.addEventListener('visibilitychange', visibilityChanged);
    poll();
    return () => {
        stopped = true;
        clearTimeout(timer);
        controller?.abort();
        page.removeEventListener('visibilitychange', visibilityChanged);
    };
}
