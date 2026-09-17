// A minimal fixed-window rate limiter, in the same spirit as inFlight.js:
// an in-memory Map keyed by caller, no external dependency. Deliberately
// per-IP rather than per-token: the crosscheck/team-family routes have both
// a token-protected path and an unauthenticated internal twin (see
// routes.js's /crosscheck/team vs /internal/crosscheck/team), so a token
// isn't a reliable identity to key on here.
//
// Single-process, in-memory state -- fine for the current one-instance
// deployment (see index.js/docker-compose.prod.yml); would need a shared
// store (e.g. Redis, already available via cache.js) if the api is ever
// scaled to multiple replicas.
const buckets = new Map();

export function rateLimit({ windowMs, max }) {
    return function rateLimitMiddleware(req, res, next) {
        const key = req.ip;
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        if (bucket.count > max) {
            res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
            return res.status(429).json({ error: 'Too Many Requests' });
        }
        next();
    };
}
