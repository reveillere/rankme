// NOT included here: "journal" -- checked against scimagojr (32k+
// entries): stripping it collides 378 pairs of genuinely distinct
// journals (e.g. "Journal of Finance" vs "Finance", "Journal of
// Hepatology" vs "Hepatology"), which would make the fuzzy match pick
// between two different journals essentially at random.
const wordsToRemove = ['acm', 'ieee', 'international', 'national', 'IFIP']
  .concat(['proceedings', 'chapter', 'association', 'magazine'])
  .concat(['in', 'of', 'to', 'on', 'for', 'at', 'the', 'and'])
  .concat(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

// Built once at module scope: normalizeTitle is called at least twice per
// ranked publication (CORE and/or SJR paths), and this regex was otherwise
// being recompiled from the same ~40-word alternation on every single call.
// Safe to share despite the `/g` flag -- `.replace()` scans and resets
// internally per call, it doesn't carry `lastIndex` across separate calls
// the way `.exec()`/`.test()` would.
const wordsToRemoveRegex = new RegExp(`\\b(?<!-)(?:${wordsToRemove.join('|')})(?!-)\\b`, 'gi');

export function normalizeTitle(line) {
  return line
    .replace(/\(.*?\)/g, '')  // remove content in parentheses
    .replace(/['"]/g, '')  // remove quotes, & and commas
    .replace(/\//g, ' ')  // replace slashes with spaces
    .replace(/:\s/g, ' ')  // replace colons followed by a space word with a space
    .replace(wordsToRemoveRegex, '')  // remove specific words and prepositions
    .replace(/\d+\w*/g, '')  // remove numbers
    .replace(/-\s/g, ' ')  // replace hyphens followed by a space word with a space
    .toLowerCase() // convert to lowercase
    .replace(/,/g, ' ') // replace commas with spaces
    .replace(/&/g, ' ') // replace & with spaces
    .split(/\s+/) // split by whitespace
    .filter(Boolean); // remove empty strings
}


// ***************************************************************************************
// ***************************************************************************************
// ***************************************************************************************

const WORKSHOP_WORD = /\bworkshops?\b/i;

// A fuzzy title match between a workshop and some unrelated (usually
// much better-ranked) conference is a specific, common failure mode: a
// workshop's own title very often differs from its host/co-located
// conference's title by only the word "workshop" itself -- e.g. "3rd
// International Workshop on Program Comprehension" vs "IEEE Conference on
// Program Comprehension" normalize to ["workshop","program","comprehension"]
// vs ["program","comprehension"], a single-word insertion (distance 1),
// comfortably within the fuzzy matcher's normal tolerance despite the two
// being entirely different venues with usually very different rankings. If
// the original text says "workshop" but the entry the matcher actually
// landed on doesn't, that's a strong, specific signal this is exactly that
// failure rather than a genuine close call -- used by corePortal.js's and
// ccfPortal.js's own fuzzy paths to downgrade such a match to "no match"
// instead of reporting it as a plausible approximate one.
export function isWorkshopMismatch(originalText, matchedText) {
  return WORKSHOP_WORD.test(originalText || '') && !WORKSHOP_WORD.test(matchedText || '');
}

export function levenshtein(str1, str2) {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j += 1) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;

      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1, // deletion
        matrix[j][i - 1] + 1, // insertion
        matrix[j - 1][i - 1] + substitutionCost, // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}