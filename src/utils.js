
export const ensureArray = (obj) => {
  return Array.isArray(obj) ? obj : obj ? [obj] : [];
};

export const trimLastDigits = (str) => {
  return str.replace(/\s*\d*$/, '').trim();
}


export function normalizeTitle(line, acronym) {
  const wordsToRemove = ['acm', 'ieee', 'international', 'national']
      .concat(['symposium', 'conference', 'workshop', 'proceedings', 'chapter', 'association'])
      .concat(['in', 'of', 'to', 'on', 'for', 'at', 'the', 'and'])
      .concat(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
  if (acronym && acronym.trim()) wordsToRemove.push(acronym.trim().toLowerCase()); // add acronym to wordsToRemove if provided


  const regex = new RegExp(`\\b(?<!-)(?:${wordsToRemove.join('|')})(?!-)\\b`, 'gi');

  return line
      .replace(/\(.*?\)/g, '')  // remove content in parentheses
      .replace(/['",]/g, '')  // remove quotes and commas
      .replace(/\//g, ' ')  // replace slashes with spaces
      .replace(/:\s/g, ' ')  // replace colons followed by a space word with a space
      .replace(regex, '')  // remove specific words and prepositions
      .replace(/\d+\w*/g, '')  // remove numbers
      .replace(/-\s/g, ' ')  // replace hyphens followed by a space word with a space
      .toLowerCase() // convert to lowercase
      .split(/\s+/) // split by whitespace
      .filter(Boolean); // remove empty strings
}


// export function distanceTitle(str1, str2) {
//   const words1 = new Set(normalize(str1, str1));
//   const words2 = new Set(normalize(str2, str2));


//   let differentWordsCount = 0;
//   let commonWordsCount = 0;

//   for (const word of words1) {
//       if (words2.has(word)) commonWordsCount++;
//       else {
//           console.log(`Different word : ${word}`);
//           differentWordsCount++;
//       }
//   }

//   for (const word of words2) {
//       if (!words1.has(word)) {
//           console.log(`Different word : ${word}`);
//           differentWordsCount++;
//       }
//   }

//   return {
//       commonWordsCount,
//       differentWordsCount
//   };
// }


export function levenshteinDistance(str1, str2) {
  const a = normalizeTitle(str1);
  const b = normalizeTitle(str2);
  
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1, // deletion
        matrix[j][i - 1] + 1, // insertion
        matrix[j - 1][i - 1] + substitutionCost, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}





// ======== Gestion du cache ========

const originalFetch = window.fetch;

const CACHE_PREFIX = 'rankme:';
const CACHE_TIME = 60 * 60 * 1000 * 24; // 1 day

async function cachedFetch(url, options, cache_duration = 1) {
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
      const expiry = now + CACHE_TIME * cache_duration;
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
