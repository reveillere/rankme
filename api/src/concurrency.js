// Shared by crosscheckStructure.js, crosscheckTeam.js and teamRecords.js:
// runs `fn` over `items` with at most `limit` in flight at once -- used to
// stay polite to HAL's shared rate limiter (see throttler.js) when a
// structure/team's member list can be in the dozens to low hundreds, while
// still being faster than doing them one at a time.
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const i = nextIndex++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
