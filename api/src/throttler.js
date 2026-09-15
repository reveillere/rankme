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

const crossref_limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 200
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
const outboundStats = new Map(); // hostname -> { total, ok, failed, rateLimited, lastCalledAt }

function recordOutbound(url, field) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = 'unknown';
  }
  const entry = outboundStats.get(hostname) || { total: 0, ok: 0, failed: 0, rateLimited: 0, lastCalledAt: null };
  entry[field]++;
  entry.lastCalledAt = Date.now();
  outboundStats.set(hostname, entry);
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
        throw new Error(`\x1b[31m\x1b[1mRequest failed with status: ${response.status}`);
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
  return {
    limiters: {
      default: default_limiter.counts(),
      crossref: crossref_limiter.counts(),
    },
    // Since process start -- not windowed/rolling like metrics.js's inbound
    // request stats, since outbound volume is orders of magnitude lower
    // (HAL/Crossref lookups per ranked publication, not per HTTP request).
    outbound: Object.fromEntries(outboundStats),
  };
}

export default fetch;
