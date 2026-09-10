import * as activeStreams from './activeStreams.js';

// Ranking one publication is CPU/memory-bound (scanning and normalizing the
// CORE/SJR candidate lists), not rate-limited like the DBLP/HAL fetches —
// but launching every publication of an author at once via Promise.all with
// no cap meant a prolific author (hundreds of publications) fired hundreds
// of these concurrently, which OOM-killed the process. Bounding concurrency
// keeps peak memory flat regardless of how many publications an author has.
//
// This used to be a Bottleneck instance (still used correctly elsewhere,
// see throttler.js, for real minTime/reservoir-based external-API rate
// limiting) -- but Bottleneck's own per-job scheduling overhead turned out
// to dominate entirely at this job count. Measured directly on a
// LaBRI-scale stream (~7860 rankable publications, fully cache-warm so the
// actual work per item is sub-millisecond): the request took ~34s through
// Bottleneck regardless of maxConcurrent (8 or 200 made no difference --
// ruling out queueing/contention), and dropped to ~0.1s with Bottleneck
// removed entirely and the exact same work run directly. Bottleneck was
// never buying anything here beyond the concurrency ceiling itself, so a
// small custom limiter replaces it -- same ceiling, negligible overhead.
class ConcurrencyLimiter {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        // priority -> FIFO array of pending tasks. A handful of distinct
        // priority values in practice (see priorityFor below), so keeping
        // one small array per value and picking the lowest-numbered
        // non-empty one on each dequeue is O(distinct priorities) rather
        // than re-sorting a queue that can hold thousands of entries.
        this.buckets = new Map();
    }

    schedule(priority, fn) {
        return new Promise((resolve, reject) => {
            if (!this.buckets.has(priority)) this.buckets.set(priority, []);
            this.buckets.get(priority).push({ fn, resolve, reject });
            this._drain();
        });
    }

    _dequeue() {
        const priorities = [...this.buckets.keys()].sort((a, b) => a - b);
        for (const p of priorities) {
            const bucket = this.buckets.get(p);
            if (bucket.length > 0) return bucket.shift();
        }
        return null;
    }

    _drain() {
        while (this.running < this.maxConcurrent) {
            const task = this._dequeue();
            if (!task) return;
            this.running++;
            this._run(task);
        }
    }

    async _run(task) {
        try {
            // Yield one microtask tick before the task body actually starts:
            // schedule() itself must stay synchronous-looking to callers (a
            // burst of N schedule() calls, as streamRankedItems' .map() does,
            // shouldn't start running task N-1 before task 0 has even been
            // enqueued) -- and, concretely, streamRankedItems' own
            // "client already disconnected" test relies on the close event
            // (fired synchronously right after all schedule() calls return,
            // before their tasks run) actually being observable by the first
            // task that checks sse.aborted.
            await Promise.resolve();
            task.resolve(await task.fn());
        } catch (error) {
            task.reject(error);
        } finally {
            this.running--;
            this._drain();
        }
    }

    counts() {
        let queued = 0;
        for (const bucket of this.buckets.values()) queued += bucket.length;
        return { running: this.running, queued };
    }
}

const ranking_limiter = new ConcurrencyLimiter(8);

// Lower number = higher priority (mirrors Bottleneck's own convention, kept
// for continuity). Without this, a single global FIFO queue meant a huge
// structure (thousands of items) could occupy every maxConcurrent slot
// ahead of a second user's tiny 20-item author lookup, which would
// otherwise finish almost instantly once actually scheduled. Three tiers is
// enough -- nothing here is latency-sensitive enough to need a continuous
// function of item count, just "small requests go first".
function priorityFor(total) {
    if (total < 50) return 2;
    if (total < 500) return 5;
    return 8;
}

// Exposed for the admin dashboard: job-level queue pressure, separate from
// activeStreams' session-level ("how many browsers are waiting") view.
export function status() {
    return ranking_limiter.counts();
}

export function startSSE(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders?.();
    // Closing the tab, reloading, or navigating away mid-stream fires this
    // -- without it, streamRankedItems below kept computing every remaining
    // publication's rank into a dead socket, burning a ranking_limiter slot
    // and CPU for a client that will never see the result.
    let aborted = false;
    req.on('close', () => { aborted = true; });
    return {
        get aborted() {
            return aborted || res.writableEnded;
        },
        send(event, data) {
            if (aborted || res.writableEnded) return;
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
        end() {
            if (!res.writableEnded) res.end();
        },
    };
}

// items: full publication list (sent as-is in `init`, unranked)
// isRankable(item) -> bool
// computeRank(item, index) -> Promise<object> (fields merged into the `rank` event)
// label: optional human-readable id (e.g. "dblp:11/1262") shown in the
// admin dashboard's "rankings in progress" list.
export async function streamRankedItems(req, res, items, isRankable, computeRank, label = 'unknown') {
    const sse = startSSE(req, res);
    const rankableIndices = items.flatMap((item, i) => (isRankable(item) ? [i] : []));
    const total = rankableIndices.length;
    sse.send('init', { publications: items, total });

    const priority = priorityFor(total);
    const streamId = activeStreams.register(label);
    try {
        let completed = 0;
        await Promise.all(rankableIndices.map((index) => ranking_limiter.schedule(priority, async () => {
            // The client is already gone -- skip starting work that would
            // just be computed into a dead socket. A task already picked up
            // by the limiter before the disconnect still runs to
            // completion (no mid-flight cancellation), but sse.send below
            // is a no-op for it either way.
            if (sse.aborted) return;
            try {
                const extra = await computeRank(items[index], index);
                completed++;
                sse.send('rank', { index, completed, total, ...extra });
            } catch (error) {
                completed++;
                // Named 'rank-error', not 'error': EventSource dispatches a
                // server-sent named event through the exact same 'error'
                // listeners (addEventListener AND onerror) as a genuine
                // connection failure -- a client using 'error' for both
                // would have its onerror handler treat a single failed
                // publication as the whole stream dying, closing the
                // connection before 'done' ever arrives (confirmed: this is
                // what "stuck at N%, never reaches 100%" on a structure with
                // any per-item ranking error turned out to be).
                sse.send('rank-error', { index, completed, total, message: error.message });
            }
            activeStreams.updateProgress(streamId, completed, total);
        })));

        sse.send('done', {});
        sse.end();
    } finally {
        activeStreams.unregister(streamId);
    }
}
