import nodeFetch from 'node-fetch';
import Bottleneck from 'bottleneck';

const MAX_RETRIES = 5;

const default_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 300 
});

const dblp_limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000 
});


async function fetch(url, options = {}, retries = MAX_RETRIES) {
  let priority = { priority: 5 };
  let limiter = default_limiter
  if (url.startsWith('https://dblp.org/')) {
    limiter = dblp_limiter;
    if (url.startsWith('https://dblp.org/search/author')) {
      priority = { priority: 1 };
    }
  } 
  return limiter.schedule(priority, async () => {
    console.log(`\x1b[31m\x1b[1m[Fetch]\x1b[0m Fetching ${url}\x1b[0m`);
    const response = await nodeFetch(url, options);

    if (response.status === 429 && retries > 0) {
      const retryAfter = response.headers.get('Retry-After') || 60;
      const waitTime = parseInt(retryAfter, 10) * 1000; 

      console.log(`\x1b[31m\x1b[1mRate limited. Retrying in ${waitTime / 1000} seconds...\x1b[0m`);

      await new Promise(resolve => setTimeout(resolve, waitTime));

      return nodeFetch(url, options, retries - 1);
    }

    if (!response.ok) {
      throw new Error(`\x1b[31m\x1b[1mRequest failed with status: ${response.status}`);
    }

    return response;
  });
}

export default fetch;
