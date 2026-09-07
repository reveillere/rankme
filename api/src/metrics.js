// In-memory request metrics for the admin dashboard. Deliberately no new
// dependency/service (no Prometheus/OTel) — this process already sees every
// request, so a small rolling window per route is enough for p50/p95/p99
// without exporting anything externally.
const ROLLING_WINDOW = 500;
const MAX_RECENT_ERRORS = 50;

const routeStats = new Map(); // `${method} ${route}` -> { count, statusCounts, durations }
const recentErrors = [];
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

function percentile(sortedDurations, p) {
  if (sortedDurations.length === 0) return 0;
  const idx = Math.min(sortedDurations.length - 1, Math.floor((p / 100) * sortedDurations.length));
  return sortedDurations[idx];
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

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    errorRate: totalRequests ? totalErrors / totalRequests : 0,
    routes,
    recentErrors: [...recentErrors].reverse(),
  };
}
