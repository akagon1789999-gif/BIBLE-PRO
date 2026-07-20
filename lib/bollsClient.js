const BASE_URL = "https://bolls.life";

function stripHtml(html) {
  if (!html) return "";
  return html
    // Strong's numbers / footnote markers: drop the whole element, not just the tag.
    .replace(/<(S|RF|F|FOOTNOTE)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchVerses(bookId, chapter, verseNumbers, translation = "KJV") {
  const res = await fetch(`${BASE_URL}/get-verses/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ translation, book: bookId, chapter, verses: verseNumbers }]),
  });
  if (!res.ok) throw new Error(`Bolls API error ${res.status}`);
  const data = await res.json();
  const list = data[0] || [];
  // Preserve requested order/gaps rather than trusting API response order.
  const found = verseNumbers.map((v) => list.find((item) => item.verse === v)).filter(Boolean);
  if (!found.length) return null;
  return { text: found.map((v) => stripHtml(v.text)).join(" ") };
}

async function fetchVerseText(bookId, chapter, verse, translation = "KJV") {
  return fetchVerses(bookId, chapter, [verse], translation);
}

const MAX_VERSE_RANGE = 30;

async function fetchVerseRange(bookId, chapter, verseStart, verseEnd, translation = "KJV") {
  const cappedEnd = Math.min(verseEnd, verseStart + MAX_VERSE_RANGE - 1);
  const verseNumbers = [];
  for (let v = verseStart; v <= cappedEnd; v++) verseNumbers.push(v);
  return fetchVerses(bookId, chapter, verseNumbers, translation);
}

// Used for paraphrase / non-exact matching: semantic vector search over a
// translation's text (Bolls uses vector similarity by default, no match_whole flag).
//
// NOTE: as of the vector-search feature's launch (16 Jul 2026), passing both
// `limit` and `page` together on a semantic query returns an empty results
// array even though `total` is correctly populated — confirmed against the
// live API. Deliberately omitting `limit` and slicing client-side instead.
async function searchVerses(query, translation = "KJV", limit = 5) {
  const url = `${BASE_URL}/v2/find/${translation}?search=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bolls API error ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, limit).map((r) => ({
    bookId: r.book,
    chapter: r.chapter,
    verse: r.verse,
    text: stripHtml(r.text),
  }));
}

// Cached in-memory: the full translation list rarely changes, and this app
// is English-only (parser, UI, Deepgram language), so only that group matters.
let englishTranslationsCache = null;

async function listEnglishTranslations() {
  if (englishTranslationsCache) return englishTranslationsCache;
  const res = await fetch(`${BASE_URL}/static/bolls/app/views/languages.json`);
  if (!res.ok) throw new Error(`Bolls API error ${res.status}`);
  const data = await res.json();
  const englishGroup = data.find((lang) => lang.language === "English");
  englishTranslationsCache = (englishGroup ? englishGroup.translations : []).map((t) => ({
    code: t.short_name,
    name: t.full_name,
  }));
  return englishTranslationsCache;
}

// Shown directly in translation pickers; every other English translation is
// tucked under a "More" group in the UI.
const POPULAR_TRANSLATION_CODES = ["AMP", "KJV", "NKJV", "ESV", "NIV", "NASB", "NLT", "ASV", "MSG", "ISV"];

module.exports = {
  fetchVerseText,
  fetchVerseRange,
  searchVerses,
  stripHtml,
  listEnglishTranslations,
  POPULAR_TRANSLATION_CODES,
};
