const { ALIAS_LOOKUP, bookById } = require("./books");
const { NUMBER_WORDS_SORTED, wordToNumber } = require("./numberWords");

const CONTEXT_TTL_MS = 90 * 1000;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOOK_ALIAS_ALTERNATION = ALIAS_LOOKUP.map((e) => escapeRegex(e.alias)).join("|");
const NUMBER_ALTERNATION = ["\\d{1,3}", ...NUMBER_WORDS_SORTED.map(escapeRegex)].join("|");

const BOOK_GROUP = `(${BOOK_ALIAS_ALTERNATION})`;
const NUM_GROUP = `(${NUMBER_ALTERNATION})`;
const TRIGGER =
  "(?:turn(?:ing)?\\s+to|open(?:ing)?\\s+(?:your\\s+bibles?\\s+)?to|open\\s+your\\s+bible\\s+to|" +
  "go(?:ing)?\\s+to|let'?s\\s+(?:turn|go|look)\\s+to|look(?:ing)?\\s+(?:with\\s+me\\s+)?at)";

const PATTERN_BOOK_CHAPTER_VERSE = new RegExp(
  `\\b${BOOK_GROUP}\\.?\\s+(?:chapter\\s+)?${NUM_GROUP}\\s*(?:[:,]|verse)\\s*${NUM_GROUP}\\b`,
  "gi"
);
const PATTERN_BOOK_CHAPTER = new RegExp(`\\b${BOOK_GROUP}\\.?\\s+(?:chapter\\s+)?${NUM_GROUP}\\b`, "gi");
const PATTERN_TRIGGER_BOOK = new RegExp(`\\b${TRIGGER}\\s+${BOOK_GROUP}\\b`, "gi");
const PATTERN_STANDALONE_CHAPTER = new RegExp(`\\bchapter\\s+${NUM_GROUP}\\b`, "gi");
const PATTERN_STANDALONE_VERSE = new RegExp(`\\bverses?\\s+${NUM_GROUP}\\b`, "gi");
const PATTERN_STANDALONE_BOOK = new RegExp(`\\b${BOOK_GROUP}\\b`, "gi");

function blank(text, start, end) {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

function createSession() {
  return { book: null, chapter: null, updatedAt: 0 };
}

function contextValid(session, now) {
  return session.book && now - session.updatedAt < CONTEXT_TTL_MS;
}

function clampReference(book, chapter, verse) {
  if (!book) return null;
  if (chapter < 1 || chapter > book.chapters) return null;
  if (verse != null && (verse < 1 || verse > 176)) return null;
  return true;
}

/**
 * Parses one finalized transcript chunk, mutating `session` (rolling
 * book/chapter context) and returning any verse suggestions found in it.
 */
function parseTranscript(text, session, now = Date.now()) {
  const suggestions = [];
  let working = " " + text + " ";

  const bookByAlias = (alias) => {
    const found = ALIAS_LOOKUP.find((e) => e.alias === alias.toLowerCase());
    return found ? found.book : null;
  };

  // 1. Fully explicit "Book chapter:verse" (e.g. "John 3:16", "Romans chapter 8 verse 1")
  for (const m of [...working.matchAll(PATTERN_BOOK_CHAPTER_VERSE)]) {
    const book = bookByAlias(m[1]);
    const chapter = wordToNumber(m[2]);
    const verse = wordToNumber(m[3]);
    if (book && chapter != null && verse != null && clampReference(book, chapter, verse)) {
      session.book = book;
      session.chapter = chapter;
      session.updatedAt = now;
      suggestions.push({
        bookId: book.id, bookName: book.name, chapter, verse,
        isChapterOnly: false, source: "explicit", raw: m[0].trim(),
      });
    }
    working = blank(working, m.index, m.index + m[0].length);
  }

  // 2. "Book chapter" only, e.g. "Romans 8" / "turn to Romans chapter 8"
  for (const m of [...working.matchAll(PATTERN_BOOK_CHAPTER)]) {
    const book = bookByAlias(m[1]);
    const chapter = wordToNumber(m[2]);
    if (book && chapter != null && clampReference(book, chapter, null)) {
      session.book = book;
      session.chapter = chapter;
      session.updatedAt = now;
      suggestions.push({
        bookId: book.id, bookName: book.name, chapter, verse: 1,
        isChapterOnly: true, source: "explicit-chapter", raw: m[0].trim(),
      });
    }
    working = blank(working, m.index, m.index + m[0].length);
  }

  // 3. Trigger phrase + book only, e.g. "turn to Romans", "open your Bible to Ephesians"
  for (const m of [...working.matchAll(PATTERN_TRIGGER_BOOK)]) {
    const book = bookByAlias(m[1]);
    if (book) {
      session.book = book;
      session.chapter = null;
      session.updatedAt = now;
    }
    working = blank(working, m.index, m.index + m[0].length);
  }

  // 4. Standalone "chapter N" relying on a recently-mentioned book
  for (const m of [...working.matchAll(PATTERN_STANDALONE_CHAPTER)]) {
    const chapter = wordToNumber(m[1]);
    if (contextValid(session, now) && chapter != null && clampReference(session.book, chapter, null)) {
      session.chapter = chapter;
      session.updatedAt = now;
      suggestions.push({
        bookId: session.book.id, bookName: session.book.name, chapter, verse: 1,
        isChapterOnly: true, source: "contextual-chapter", raw: m[0].trim(),
      });
    }
    working = blank(working, m.index, m.index + m[0].length);
  }

  // 5. Standalone "verse N" relying on recently-mentioned book + chapter
  for (const m of [...working.matchAll(PATTERN_STANDALONE_VERSE)]) {
    const verse = wordToNumber(m[1]);
    if (contextValid(session, now) && session.chapter && verse != null &&
        clampReference(session.book, session.chapter, verse)) {
      session.updatedAt = now;
      suggestions.push({
        bookId: session.book.id, bookName: session.book.name, chapter: session.chapter, verse,
        isChapterOnly: false, source: "contextual-verse", raw: m[0].trim(),
      });
    }
    working = blank(working, m.index, m.index + m[0].length);
  }

  // 6. A bare book name mention (weak signal) — just refreshes context, no suggestion.
  for (const m of [...working.matchAll(PATTERN_STANDALONE_BOOK)]) {
    const book = bookByAlias(m[1]);
    if (book) {
      session.book = book;
      session.chapter = null;
      session.updatedAt = now;
    }
  }

  return suggestions;
}

module.exports = { createSession, parseTranscript, CONTEXT_TTL_MS };
