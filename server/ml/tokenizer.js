/* ============================================================
   Text tokenizer for the ML classifier.
   Lowercases, strips punctuation/numbers, applies a light
   suffix stemmer, and removes common stopwords.
   ============================================================ */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those', 'was',
  'were', 'been', 'being', 'have', 'has', 'had', 'will', 'would', 'shall',
  'should', 'can', 'could', 'may', 'might', 'must', 'not', 'but', 'are', 'is',
  'am', 'do', 'does', 'did', 'done', 'doing', 'a', 'an', 'of', 'in', 'on', 'at',
  'to', 'by', 'as', 'or', 'if', 'then', 'than', 'so', 'such', 'too', 'very',
  'just', 'about', 'after', 'before', 'between', 'during', 'into', 'out', 'over',
  'under', 'again', 'further', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'no', 'nor', 'only', 'own', 'same', 'up', 'down', 'off', 'above', 'below',
  'through', 'because', 'while', 'against', 'among', 'around', 'behind',
  'inside', 'outside', 'since', 'until', 'what', 'which', 'who', 'whom',
  'whose', 'them', 'they', 'their', 'there', 'its', 'it', 'i', 'me', 'my',
  'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'hers',
  'please', 'today', 'yesterday', 'morning', 'evening', 'night', 'day', 'went',
  'came', 'got', 'get', 'said', 'told', 'see', 'saw', 'come', 'go', 'went',
  'make', 'made', 'thing', 'things', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten', 'first', 'last', 'next', 'also',
  'still', 'even', 'ever', 'never', 'always', 'often', 'some', 'any', 'every',
  'much', 'many', 'lot', 'really', 'very', 'around', 'along', 'away', 'back',
  'being', 'having', 'doing', 'getting', 'going', 'coming', 'need', 'wants',
  'want', 'called', 'call', 'using', 'use', 'used', 'take', 'took', 'give',
  'gave', 'put', 'left', 'right', 'now', 'later', 'earlier', 'recently',
]);

// Light suffix stemmer (Porter-ish subset, tuned for English crime reports)
function stem(word) {
  if (word.length <= 3) return word;
  let w = word;
  // Remove plurals / 3rd-person -s
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 4) w = w.slice(0, -1);
  // Remove -ing / -ed (keep stem >= 4 chars)
  if (w.endsWith('ing') && w.length - 3 >= 4) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length - 2 >= 4) w = w.slice(0, -2);
  // Remove common adverbial/adjectival suffixes (keep stem >= 5 chars)
  else if (w.endsWith('ly') && w.length - 2 >= 5) w = w.slice(0, -2);
  else if (w.endsWith('ment') && w.length - 4 >= 5) w = w.slice(0, -4);
  else if (w.endsWith('al') && w.length - 2 >= 5) w = w.slice(0, -2);
  // Normalize doubled consonants at the end (e.g. stopped -> stop)
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) {
    const ch = w[w.length - 1];
    if ('bcdfghjklmnpqrstvwxz'.includes(ch)) w = w.slice(0, -1);
  }
  return w;
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !/^\d+$/.test(w))
    .map(stem)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

module.exports = { tokenize, stem, STOPWORDS };