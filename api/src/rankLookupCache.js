import * as cache from './cache.js';
import { dedupeInFlight } from './inFlight.js';

// Shared by sjrPortal.js/corePortal.js/ccfPortal.js's own getRankBy*/
// getRankFor* functions: each computes an expensive (year/edition, venue)
// rank, so every one of them follows the same "check a prefetched batch or
// Redis, dedupe concurrent callers for the same not-yet-cached key while one
// shared compute() runs, then cache the result" shape -- only `compute`
// itself (the actual matching strategy) differs per portal, which is why
// this factors out the wrapper but deliberately NOT the result shape those
// compute functions build (unrankedResult/ambiguousResult/sanitizedRank):
// CORE's carries extra fields (rawValue, matchedAcronym, currentRawValue)
// SJR/CCF's don't, so forcing those into one shape risked exactly the kind
// of edge-case bug this factoring is meant to avoid, for little real gain.
//
// Each call site should keep its own instance (own inFlight Map) per
// distinct key space -- e.g. corePortal.js's by-full-name and by-acronym
// lookups are two separate instances, not one shared between them.
export function createCachedRankLookup(ttlS) {
    const inFlight = new Map();
    return async function getCachedRank(key, compute, prefetched) {
        const cached = prefetched?.has(key) ? prefetched.get(key) : await cache.get(key);
        if (cached !== null && cached !== undefined) return cached;

        return dedupeInFlight(inFlight, key, async () => {
            const result = await compute();
            // Awaited (unlike cache.set's usual fire-and-forget elsewhere):
            // the in-flight map entry above is removed the instant this
            // wrapper's promise settles (see dedupeInFlight), so a caller
            // arriving between "computed" and "actually written to Redis"
            // would otherwise sail past both the map (already cleared) and
            // cache.get (not yet written) and recompute anyway -- observed
            // happening under real concurrent load while this was still
            // three separate, independently-verified copies.
            await cache.set(key, result, ttlS);
            return result;
        });
    };
}
