import nodeFetch from 'node-fetch';
import Bottleneck from 'bottleneck';

// Default 429 retry policy: up to 5 retries, each waiting whatever the
// server's Retry-After header says (or 60s if it didn't send one) -- fine
// for DBLP calls, which streamRankedItems is directly waiting on.
// Crossref's DOI lookup (crossref.js's getVenueInfo) is a best-effort
// fallback -- already wrapped in a try/catch that degrades to "no venue
// info" on any failure -- so the SAME retry budget was actively harmful
// there: a single 429'd request could occupy one of crossref_limiter's 2
// concurrent slots for up to 5x60s = 5 minutes, and observed in prod (a run
// of "Rate limited. Retrying in 60 seconds..." log lines) stalling a large
// structure's streaming progress in the 80s% range for a very long time
// as the tail of harder-to-match publications queued up behind it. A much
// smaller budget here means Crossref just gets skipped quickly for that
// one publication (falling back to the local-only match) instead of
// blocking everything behind it.
const RETRY_POLICY = {
  default: { maxRetries: 5, retryWaitCapMs: 60000 },
  crossref: { maxRetries: 1, retryWaitCapMs: 5000 },
};
const FETCH_TIMEOUT_MS = 20000;

const default_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 300
});

// minTime: 200 alone already caps sustained throughput at 1000/200 = 5
// req/s -- confirmed live against Crossref's own response headers
// (x-rate-limit-limit: 5, x-rate-limit-interval: 1s) on 2026-09-15, not
// guessed. That's the real ceiling and stays put. maxConcurrent bumped
// from 2 to 4: minTime still gates how fast new requests can *start*
// regardless of this value, so raising it only helps when Crossref's own
// response latency (not our own rate) is what's leaving slots idle
// between the 200ms ticks -- it can't push us past the 5 req/s limit above.
const crossref_limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 200
});

// HAL used to share default_limiter with DBLP-dump/CORE/SJR -- on a lab
// structure/team with many members (hal.js's batched author/publication
// calls), that meant HAL calls queued behind whatever unrelated call from
// another source happened to be in flight, and vice versa. Same
// conservative numbers as default_limiter for now (no measured HAL rate
// ceiling on file the way crossref_limiter's is, see its own comment above)
// -- this only isolates HAL's queue from the others, it doesn't loosen it.
const hal_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 300
});

// Every outbound call this process makes goes through this one function
// (admin.js's DBLP dump download, crossref.js, corePortal.js, ccfPortal.js,
// hal.js, sjrPortal.js), so it's the one place that can answer "what is
// rankme actually calling out to, and how is that going" -- for the admin
// dashboard and Prometheus (see admin.js's controllerStats/
// controllerPrometheusMetrics), not for any behavioral decision here.
// Keyed by hostname rather than full URL: HAL/Crossref/DBLP-dump URLs
// each carry a distinct ID/DOI per call, so counting by exact URL would
// grow this map without bound over the process's lifetime.
const outboundAllTime = new Map(); // hostname -> { total, ok, failed, rateLimited, lastCalledAt } (never pruned -- the admin dashboard's "full" range)

// Hourly rollup for the admin dashboard's 1h/24h/30d views -- same
// resolution/retention tradeoff as metrics.js's own hourlyBuckets (outbound
// volume is far lower than inbound HTTP, so even 1h would be a single
// point at hourly resolution, but consistency with the traffic section's
// own bucket size matters more here than precision).
const HOUR_MS = 60 * 60 * 1000;
const HISTORY_HOURS = 31 * 24; // ~1 month
const outboundHourly = new Map(); // hostname -> Map(hourStart(ms) -> { total, ok, failed, rateLimited })

function currentHourStart(now = Date.now()) {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

function pruneOldHourly(hostBuckets) {
  const cutoff = currentHourStart() - HISTORY_HOURS * HOUR_MS;
  for (const key of hostBuckets.keys()) {
    if (key < cutoff) hostBuckets.delete(key);
  }
}

function recordOutbound(url, field) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = 'unknown';
  }

  const allTimeEntry = outboundAllTime.get(hostname) || { total: 0, ok: 0, failed: 0, rateLimited: 0, lastCalledAt: null };
  allTimeEntry[field]++;
  allTimeEntry.lastCalledAt = Date.now();
  outboundAllTime.set(hostname, allTimeEntry);

  let hostBuckets = outboundHourly.get(hostname);
  if (!hostBuckets) {
    hostBuckets = new Map();
    outboundHourly.set(hostname, hostBuckets);
  }
  const hourStart = currentHourStart();
  let hourlyEntry = hostBuckets.get(hourStart);
  if (!hourlyEntry) {
    hourlyEntry = { total: 0, ok: 0, failed: 0, rateLimited: 0 };
    hostBuckets.set(hourStart, hourlyEntry);
    pruneOldHourly(hostBuckets);
  }
  hourlyEntry[field]++;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await nodeFetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetch(url, options = {}) {
  let priority = { priority: 5 };
  let limiter = default_limiter;
  let retryPolicy = RETRY_POLICY.default;
  if (url.startsWith('https://api.crossref.org/')) {
    limiter = crossref_limiter;
    retryPolicy = RETRY_POLICY.crossref;
  } else if (url.startsWith('https://api.archives-ouvertes.fr/')) {
    limiter = hal_limiter;
  }

  // Retries stay inside this single scheduled task: recursing back through
  // limiter.schedule() here would enqueue a new task on the same
  // maxConcurrent:1 limiter while this one is still running (awaiting that
  // very task) — a deadlock that starves the queue for every later request.
  recordOutbound(url, 'total');
  return limiter.schedule(priority, async () => {
    let retries = retryPolicy.maxRetries;
    while (true) {
      console.log(`\x1b[31m\x1b[1m[Fetch]\x1b[0m Fetching ${url}\x1b[0m`);
      const response = await fetchWithTimeout(url, options).catch(error => {
        recordOutbound(url, 'failed');
        throw error;
      });

      if (response.status === 429 && retries > 0) {
        retries--;
        recordOutbound(url, 'rateLimited');
        const retryAfter = response.headers.get('Retry-After');
        const requestedWaitMs = (isNaN(parseInt(retryAfter, 10)) ? 60 : parseInt(retryAfter, 10)) * 1000;
        const waitTime = Math.min(requestedWaitMs, retryPolicy.retryWaitCapMs);

        console.log(`\x1b[31m\x1b[1mRate limited. Retrying in ${waitTime / 1000} seconds...\x1b[0m`);

        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        recordOutbound(url, 'failed');
        // .status set explicitly (not left to callers regexing the message)
        // so callers can tell a permanent-looking outcome (404: this DOI/
        // resource simply isn't there) from a transient one (5xx, or a 429
        // that ran out of retries) -- see crossref.js's own use of this to
        // pick a cache TTL.
        const error = new Error(`\x1b[31m\x1b[1mRequest failed with status: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      recordOutbound(url, 'ok');
      return response;
    }
  });
}

// Exposed for the admin dashboard: each limiter's .counts() (built into
// Bottleneck, already a dependency) shows queue pressure without needing a
// separate metrics system.
export function status() {
  const outbound = {};
  for (const [hostname, full] of outboundAllTime) {
    const hourlyHistory = [...(outboundHourly.get(hostname)?.entries() ?? [])]
      .sort(([a], [b]) => a - b)
      .map(([time, b]) => ({ time, ...b }));
    outbound[hostname] = { full, hourlyHistory };
  }
  return {
    limiters: {
      default: default_limiter.counts(),
      crossref: crossref_limiter.counts(),
      hal: hal_limiter.counts(),
    },
    outbound,
  };
}

export default fetch;
