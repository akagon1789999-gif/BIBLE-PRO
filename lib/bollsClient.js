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

async function fetchVerseText(bookId, chapter, verse, translation = "KJV") {
  const res = await fetch(`${BASE_URL}/get-verses/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ translation, book: bookId, chapter, verses: [verse] }]),
  });
  if (!res.ok) throw new Error(`Bolls API error ${res.status}`);
  const data = await res.json();
  const list = data[0] || [];
  const found = list.find((v) => v.verse === verse) || list[0];
  if (!found) return null;
  return { text: stripHtml(found.text), pk: found.pk };
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

module.exports = { fetchVerseText, searchVerses, stripHtml };
