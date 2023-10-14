export function normalizeTitle(line) {
  const wordsToRemove = ['acm', 'ieee', 'international', 'national', 'IFIP']
      .concat(['symposium', 'conference', 'workshop', 'proceedings', 'chapter', 'association'])
      .concat(['in', 'of', 'to', 'on', 'for', 'at', 'the', 'and'])
      .concat(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);


  const regex = new RegExp(`\\b(?<!-)(?:${wordsToRemove.join('|')})(?!-)\\b`, 'gi');

  return line
      .replace(/\(.*?\)/g, '')  // remove content in parentheses
      .replace(/['",&]/g, '')  // remove quotes, & and commas
      .replace(/\//g, ' ')  // replace slashes with spaces
      .replace(/:\s/g, ' ')  // replace colons followed by a space word with a space
      .replace(regex, '')  // remove specific words and prepositions
      .replace(/\d+\w*/g, '')  // remove numbers
      .replace(/-\s/g, ' ')  // replace hyphens followed by a space word with a space
      .toLowerCase() // convert to lowercase
      .split(/\s+/) // split by whitespace
      .filter(Boolean); // remove empty strings
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