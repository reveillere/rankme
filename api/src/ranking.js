import Bottleneck from 'bottleneck';
import * as activeStreams from './activeStreams.js';

// Ranking one publication is CPU/memory-bound (scanning and normalizing the
// CORE/SJR candidate lists), not rate-limited like the DBLP/HAL fetches —
// but launching every publication of an author at once via Promise.all with
// no cap meant a prolific author (hundreds of publications) fired hundreds
// of these concurrently, which OOM-killed the process. Bounding concurrency
// keeps peak memory flat regardless of how many publications an author has.
const ranking_limiter = new Bottleneck({ maxConcurrent: 8 });

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

    const streamId = activeStreams.register(label);
    try {
        let completed = 0;
        await Promise.all(rankableIndices.map((index) => ranking_limiter.schedule(async () => {
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
                sse.send('error', { index, completed, total, message: error.message });
            }
            activeStreams.updateProgress(streamId, completed, total);
        })));

        sse.send('done', {});
        sse.end();
    } finally {
        activeStreams.unregister(streamId);
    }
}
