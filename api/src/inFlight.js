// Shared by sjrPortal.js, corePortal.js, and hal.js: each wraps a
// Redis-cached, expensive-to-compute lookup (a venue rank, or a paginated
// HAL fetch) where two callers can race on the same not-yet-cached key at
// the same time -- e.g. two browser tabs opening the same HAL structure, or
// two different publications both needing the same venue string ranked.
// Without this, both callers miss the Redis cache (it isn't written until
// the first one finishes) and independently redo the same CPU/network work
// for the exact same result. Mirrors the front end's identical fix for the
// same shape of problem (front/src/matchOverrides.js's
// sharedOverridesPromiseByPortal): the first caller's in-flight Promise is
// shared with anyone else asking for the same key before it resolves, then
// removed from `map` so a later call -- once the result is already sitting
// in Redis -- goes back to the cheap cache-read path instead of hitting this
// map forever.
export function dedupeInFlight(map, key, compute) {
    let promise = map.get(key);
    if (!promise) {
        promise = compute().finally(() => map.delete(key));
        map.set(key, promise);
    }
    return promise;
}
