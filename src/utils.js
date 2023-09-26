const originalFetch = window.fetch;

const CACHE_PREFIX = 'rankme:';
const CACHE_TIME = 60 * 60 * 1000 * 24 ; // 1 day

async function cachedFetch(url, options) {
  const cacheKey = CACHE_PREFIX + url;
  const cached = localStorage.getItem(cacheKey);
  const now = Date.now();

  if (cached) {
    const { expiry, data } = JSON.parse(cached);
    if (now < expiry) {
      return new Response(new Blob([data]), { status: 200, statusText: 'OK' });
    }
    localStorage.removeItem(cacheKey); // Supprimer les données périmées du cache
  }

  try {
    const response = await originalFetch(url, options);
    if (response.ok) {
      const data = await response.clone().text();
      const expiry = now + CACHE_TIME;
      saveToCache(cacheKey, JSON.stringify({ expiry, data }));
    }
    return response;
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
}


function saveToCache(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.code === 22) { // 22 is QuotaExceededError
      const entries = Object.entries(localStorage)
        .filter(([k]) => k.startsWith(CACHE_PREFIX))
        .map(([k, v]) => [k, JSON.parse(v)]);

      // Trier par date d'expiration et supprimer les plus anciens
      entries.sort(([, { expiry: a }], [, { expiry: b }]) => a - b);
      for (const [k] of entries) {
        localStorage.removeItem(k);
        try {
          localStorage.setItem(key, value);
          break;
        } catch {} 
      }
    } else {
      console.error('LocalStorage error:', e);
    }
  }
}

window.fetch = cachedFetch;
