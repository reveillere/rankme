import nodeFetch from 'node-fetch';
import Bottleneck from 'bottleneck';

const MAX_RETRIES = 5;
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

    let retries = MAX_RETRIES;
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
        const waitTime = (isNaN(parseInt(retryAfter, 10)) ? 60 : parseInt(retryAfter, 10)) * 1000;

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

export default fetch;
