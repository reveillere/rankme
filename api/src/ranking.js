import Bottleneck from 'bottleneck';

// Ranking one publication is CPU/memory-bound (scanning and normalizing the
// CORE/SJR candidate lists), not rate-limited like the DBLP/HAL fetches —
// but launching every publication of an author at once via Promise.all with
// no cap meant a prolific author (hundreds of publications) fired hundreds
// of these concurrently, which OOM-killed the process. Bounding concurrency
// keeps peak memory flat regardless of how many publications an author has.
const ranking_limiter = new Bottleneck({ maxConcurrent: 8 });

export function startSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders?.();
    return {
        send(event, data) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
        end() {
            res.end();
        },
    };
}

// items: full publication list (sent as-is in `init`, unranked)
// isRankable(item) -> bool
// computeRank(item, index) -> Promise<object> (fields merged into the `rank` event)
export async function streamRankedItems(res, items, isRankable, computeRank) {
    const sse = startSSE(res);
    const rankableIndices = items.flatMap((item, i) => (isRankable(item) ? [i] : []));
    sse.send('init', { publications: items, total: rankableIndices.length });

    let completed = 0;
    await Promise.all(rankableIndices.map((index) => ranking_limiter.schedule(async () => {
        try {
            const extra = await computeRank(items[index], index);
            completed++;
            sse.send('rank', { index, completed, total: rankableIndices.length, ...extra });
        } catch (error) {
            completed++;
            sse.send('error', { index, completed, total: rankableIndices.length, message: error.message });
        }
    })));

    sse.send('done', {});
    sse.end();
}
