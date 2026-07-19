const { searchVerses } = require("./bollsClient");
const { coverageScore, significantWordCount } = require("./textSimilarity");
const { bookById } = require("./books");

// Catches verses that are quoted/paraphrased in the pastor's own words rather
// than cited by reference. Runs only when the explicit parser found nothing,
// accumulating a rolling window of recent speech and running it through
// Bolls' semantic search once there's enough substance to search on.
const BUFFER_WINDOW_MS = 15 * 1000;
const MIN_SIGNIFICANT_WORDS = 6;
const SEMANTIC_THROTTLE_MS = 8 * 1000;
// Calibrated against Bolls' live vector search: genuine paraphrases of well-known
// verses scored ~0.43 coverage, unrelated sermon chit-chat topped out at ~0.10.
const COVERAGE_THRESHOLD = 0.3;
const SEARCH_RESULT_LIMIT = 3;

function createBufferState() {
  return { chunks: [], lastSemanticAt: 0, lastSearchedText: "" };
}

function clearBuffer(bufferState) {
  bufferState.chunks = [];
}

function trimBuffer(bufferState, now) {
  bufferState.chunks = bufferState.chunks.filter((c) => now - c.ts < BUFFER_WINDOW_MS);
}

function bufferText(bufferState) {
  return bufferState.chunks.map((c) => c.text).join(" ").trim();
}

/**
 * @returns a suggestion-shaped object (with source: "semantic" and a text/
 *          score already attached) or null if nothing confident was found.
 */
async function findParaphraseMatch(bufferState, newText, now, translation) {
  bufferState.chunks.push({ text: newText, ts: now });
  trimBuffer(bufferState, now);

  const combined = bufferText(bufferState);
  if (significantWordCount(combined) < MIN_SIGNIFICANT_WORDS) return null;
  if (now - bufferState.lastSemanticAt < SEMANTIC_THROTTLE_MS) return null;
  if (combined === bufferState.lastSearchedText) return null;

  bufferState.lastSemanticAt = now;
  bufferState.lastSearchedText = combined;

  let results;
  try {
    results = await searchVerses(combined, translation, SEARCH_RESULT_LIMIT);
  } catch (err) {
    console.error("Semantic search failed:", err.message);
    return null;
  }

  let best = null;
  for (const r of results) {
    const score = coverageScore(combined, r.text);
    if (!best || score > best.score) best = { ...r, score };
  }
  if (!best || best.score < COVERAGE_THRESHOLD) return null;

  const book = bookById(best.bookId);
  if (!book) return null;

  clearBuffer(bufferState); // a confident hit shouldn't be re-suggested from the same quote

  return {
    bookId: book.id,
    bookName: book.name,
    chapter: best.chapter,
    verse: best.verse,
    isChapterOnly: false,
    source: "semantic",
    raw: combined,
    text: best.text,
    score: Math.round(best.score * 100),
  };
}

module.exports = { createBufferState, clearBuffer, findParaphraseMatch };
