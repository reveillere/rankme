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

const dblp_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000
});

// dblp.org/db/... venue-page scraping (searchTitle/getVenueFullName in dblp.js)
// is heavier and less essential than the search/author-lookup APIs above, and
// is the traffic pattern that preceded the ~16h DBLP block found in prod logs
// (a burst of dozens of .xml page fetches). Throttled and circuit-broken
// separately so a burst here can't eat the budget of, or get DBLP annoyed on
// behalf of, interactive search/author requests.
const dblp_scrape_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2500
});

const crossref_limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 200
});

let scrapeFailureStreak = 0;
let scrapeCooldownUntil = 0;
const SCRAPE_FAILURE_THRESHOLD = 5;
const SCRAPE_COOLDOWN_MS = 5 * 60 * 1000;

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
  let isScrape = false;
  let retryPolicy = RETRY_POLICY.default;
  if (url.startsWith('https://dblp.org/')) {
    if (url.startsWith('https://dblp.org/db/')) {
      limiter = dblp_scrape_limiter;
      isScrape = true;
    } else {
      limiter = dblp_limiter;
      if (url.startsWith('https://dblp.org/search/author')) {
        priority = { priority: 1 };
      }
    }
  } else if (url.startsWith('https://api.crossref.org/')) {
    limiter = crossref_limiter;
    retryPolicy = RETRY_POLICY.crossref;
  }

  // Retries stay inside this single scheduled task: recursing back through
  // limiter.schedule() here would enqueue a new task on the same
  // maxConcurrent:1 limiter while this one is still running (awaiting that
  // very task) — a deadlock that starves the queue for every later request.
  return limiter.schedule(priority, async () => {
    // Checked here, at execution time, not before scheduling: a burst of
    // concurrent callers (e.g. streaming ranks for every publication of an
    // author) can all pass a pre-schedule check before any of them has
    // failed yet, queuing dozens of doomed requests that would otherwise
    // keep running throughout the "paused" window.
    if (isScrape && Date.now() < scrapeCooldownUntil) {
      throw new Error(`DBLP venue scraping paused after repeated failures, retrying after ${new Date(scrapeCooldownUntil).toISOString()}`);
    }

    let retries = retryPolicy.maxRetries;
    while (true) {
      console.log(`\x1b[31m\x1b[1m[Fetch]\x1b[0m Fetching ${url}\x1b[0m`);
      let response;
      try {
        response = await fetchWithTimeout(url, options);
      } catch (err) {
        if (isScrape) recordScrapeFailure();
        throw err;
      }

      if (response.status === 429 && retries > 0) {
        retries--;
        const retryAfter = response.headers.get('Retry-After');
        const requestedWaitMs = (isNaN(parseInt(retryAfter, 10)) ? 60 : parseInt(retryAfter, 10)) * 1000;
        const waitTime = Math.min(requestedWaitMs, retryPolicy.retryWaitCapMs);

        console.log(`\x1b[31m\x1b[1mRate limited. Retrying in ${waitTime / 1000} seconds...\x1b[0m`);

        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        if (isScrape) recordScrapeFailure();
        throw new Error(`\x1b[31m\x1b[1mRequest failed with status: ${response.status}`);
      }

      if (isScrape) scrapeFailureStreak = 0;
      return response;
    }
  });
}

function recordScrapeFailure() {
  scrapeFailureStreak++;
  if (scrapeFailureStreak >= SCRAPE_FAILURE_THRESHOLD) {
    scrapeCooldownUntil = Date.now() + SCRAPE_COOLDOWN_MS;
    console.log(`\x1b[31m\x1b[1m[Fetch]\x1b[0m DBLP venue scraping paused for ${SCRAPE_COOLDOWN_MS / 1000}s after ${scrapeFailureStreak} consecutive failures\x1b[0m`);
  }
}

// Exposed for the admin dashboard: each limiter's .counts() (built into
// Bottleneck, already a dependency) shows queue pressure without needing a
// separate metrics system.
export function status() {
  return {
    limiters: {
      default: default_limiter.counts(),
      dblp: dblp_limiter.counts(),
      dblpScrape: dblp_scrape_limiter.counts(),
      crossref: crossref_limiter.counts(),
    },
    scrape: {
      failureStreak: scrapeFailureStreak,
      cooldownUntil: scrapeCooldownUntil || null,
      coolingDown: Date.now() < scrapeCooldownUntil,
    },
  };
}

export default fetch;
