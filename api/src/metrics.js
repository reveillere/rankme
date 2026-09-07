// In-memory request metrics for the admin dashboard. Deliberately no new
// dependency/service (no Prometheus/OTel) — this process already sees every
// request, so a small rolling window per route is enough for p50/p95/p99
// without exporting anything externally.
const ROLLING_WINDOW = 500;
const MAX_RECENT_ERRORS = 50;
const BUCKET_MS = 60 * 1000; // 1-minute buckets
const HISTORY_BUCKETS = 60; // last hour

const routeStats = new Map(); // `${method} ${route}` -> { count, statusCounts, durations }
const recentErrors = [];
const buckets = new Map(); // bucketStart(ms) -> { count, errors, ips: Set }
const allClientIps = new Set();
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

function percentile(sortedDurations, p) {
  if (sortedDurations.length === 0) return 0;
  const idx = Math.min(sortedDurations.length - 1, Math.floor((p / 100) * sortedDurations.length));
  return sortedDurations[idx];
}

// The API only ever sees traffic through the reverseproxy container, which
// sets these — trusting them here doesn't open anything up to spoofing from
// the outside since nginx overwrites them for every request it forwards.
function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function currentBucketStart(now = Date.now()) {
  return Math.floor(now / BUCKET_MS) * BUCKET_MS;
}

function pruneOldBuckets() {
  const cutoff = currentBucketStart() - HISTORY_BUCKETS * BUCKET_MS;
  for (const key of buckets.keys()) {
    if (key < cutoff) buckets.delete(key);
  }
}

export function middleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    // req.route.path is the matched pattern (e.g. '/dblp/author/*'), not the
    // raw URL — grouping by pattern keeps per-PID/per-query requests from
    // each becoming their own row.
    const routeLabel = req.route?.path ? req.route.path : req.path;
    const key = `${req.method} ${routeLabel}`;

    let stat = routeStats.get(key);
    if (!stat) {
      stat = { count: 0, statusCounts: {}, durations: [] };
      routeStats.set(key, stat);
    }
    stat.count++;
    stat.statusCounts[res.statusCode] = (stat.statusCounts[res.statusCode] || 0) + 1;
    stat.durations.push(durationMs);
    if (stat.durations.length > ROLLING_WINDOW) stat.durations.shift();

    totalRequests++;
    if (res.statusCode >= 400) {
      totalErrors++;
      recentErrors.push({ time: Date.now(), method: req.method, path: req.originalUrl, status: res.statusCode });
      if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
    }

    const ip = getClientIp(req);
    allClientIps.add(ip);
    const bucketStart = currentBucketStart();
    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { count: 0, errors: 0, ips: new Set() };
      buckets.set(bucketStart, bucket);
      pruneOldBuckets();
    }
    bucket.count++;
    if (res.statusCode >= 400) bucket.errors++;
    bucket.ips.add(ip);
  });

  next();
}

export function snapshot() {
  const routes = [...routeStats.entries()]
    .map(([route, stat]) => {
      const sorted = [...stat.durations].sort((a, b) => a - b);
      return {
        route,
        count: stat.count,
        statusCounts: stat.statusCounts,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
      };
    })
    .sort((a, b) => b.count - a.count);

  const now = currentBucketStart();
  const history = [];
  for (let i = HISTORY_BUCKETS - 1; i >= 0; i--) {
    const time = now - i * BUCKET_MS;
    const bucket = buckets.get(time);
    history.push({
      time,
      count: bucket?.count || 0,
      errors: bucket?.errors || 0,
      distinctClients: bucket?.ips.size || 0,
    });
  }

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    errorRate: totalRequests ? totalErrors / totalRequests : 0,
    totalDistinctClients: allClientIps.size,
    history,
    routes,
    recentErrors: [...recentErrors].reverse(),
  };
}
