// Lightweight local scoring for candidates returned by Bolls' semantic search.
// The API ranks results but doesn't return a numeric score, so we compute our
// own word-overlap coverage to filter out weak/coincidental matches before
// ever suggesting them to the operator.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "to", "is", "are", "was", "were",
  "that", "this", "it", "for", "with", "as", "be", "he", "his", "her", "they", "we", "you",
  "i", "them", "their", "our", "us", "so", "not", "shall", "will", "unto", "which", "who",
  "at", "by", "from", "if", "then", "than", "when", "there", "have", "has", "had", "do", "did",
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Fraction of the spoken (query) words that also appear in the candidate verse.
// Recall-oriented against the query: a short accurate paraphrase of a long
// verse should still score well.
function coverageScore(queryText, verseText) {
  const queryWords = new Set(tokenize(queryText));
  const verseWords = new Set(tokenize(verseText));
  if (queryWords.size === 0) return 0;
  let hits = 0;
  for (const w of queryWords) {
    if (verseWords.has(w)) hits++;
  }
  return hits / queryWords.size;
}

function significantWordCount(text) {
  return tokenize(text).length;
}

module.exports = { coverageScore, significantWordCount, tokenize };
