// Canonical 66-book list (Bolls bookid 1-66) with spoken-form aliases.
// Aliases cover common abbreviations and "First/Second/Third" word forms,
// since a pastor says "First Corinthians" rather than "1 Corinthians".
const BOOKS = [
  { id: 1, name: "Genesis", chapters: 50, aliases: ["genesis", "gen"] },
  { id: 2, name: "Exodus", chapters: 40, aliases: ["exodus", "exo", "ex"] },
  { id: 3, name: "Leviticus", chapters: 27, aliases: ["leviticus", "lev"] },
  { id: 4, name: "Numbers", chapters: 36, aliases: ["numbers", "num"] },
  { id: 5, name: "Deuteronomy", chapters: 34, aliases: ["deuteronomy", "deut", "deu"] },
  { id: 6, name: "Joshua", chapters: 24, aliases: ["joshua", "josh"] },
  { id: 7, name: "Judges", chapters: 21, aliases: ["judges", "judg", "jdg"] },
  { id: 8, name: "Ruth", chapters: 4, aliases: ["ruth"] },
  { id: 9, name: "1 Samuel", chapters: 31, aliases: ["1 samuel", "first samuel", "1st samuel", "i samuel", "1 sam"] },
  { id: 10, name: "2 Samuel", chapters: 24, aliases: ["2 samuel", "second samuel", "2nd samuel", "ii samuel", "2 sam"] },
  { id: 11, name: "1 Kings", chapters: 22, aliases: ["1 kings", "first kings", "1st kings", "i kings"] },
  { id: 12, name: "2 Kings", chapters: 25, aliases: ["2 kings", "second kings", "2nd kings", "ii kings"] },
  { id: 13, name: "1 Chronicles", chapters: 29, aliases: ["1 chronicles", "first chronicles", "1st chronicles", "i chronicles", "1 chron"] },
  { id: 14, name: "2 Chronicles", chapters: 36, aliases: ["2 chronicles", "second chronicles", "2nd chronicles", "ii chronicles", "2 chron"] },
  { id: 15, name: "Ezra", chapters: 10, aliases: ["ezra"] },
  { id: 16, name: "Nehemiah", chapters: 13, aliases: ["nehemiah", "neh"] },
  { id: 17, name: "Esther", chapters: 16, aliases: ["esther", "esth"] },
  { id: 18, name: "Job", chapters: 42, aliases: ["job"] },
  { id: 19, name: "Psalms", chapters: 150, aliases: ["psalms", "psalm", "psa", "psm"] },
  { id: 20, name: "Proverbs", chapters: 31, aliases: ["proverbs", "prov", "prv"] },
  { id: 21, name: "Ecclesiastes", chapters: 12, aliases: ["ecclesiastes", "eccles", "eccl"] },
  { id: 22, name: "Song of Solomon", chapters: 8, aliases: ["song of solomon", "song of songs", "song"] },
  { id: 23, name: "Isaiah", chapters: 66, aliases: ["isaiah", "isa"] },
  { id: 24, name: "Jeremiah", chapters: 52, aliases: ["jeremiah", "jer"] },
  { id: 25, name: "Lamentations", chapters: 5, aliases: ["lamentations", "lam"] },
  { id: 26, name: "Ezekiel", chapters: 48, aliases: ["ezekiel", "ezek", "eze"] },
  { id: 27, name: "Daniel", chapters: 12, aliases: ["daniel", "dan"] },
  { id: 28, name: "Hosea", chapters: 14, aliases: ["hosea", "hos"] },
  { id: 29, name: "Joel", chapters: 3, aliases: ["joel"] },
  { id: 30, name: "Amos", chapters: 9, aliases: ["amos"] },
  { id: 31, name: "Obadiah", chapters: 1, aliases: ["obadiah", "obad"] },
  { id: 32, name: "Jonah", chapters: 4, aliases: ["jonah"] },
  { id: 33, name: "Micah", chapters: 7, aliases: ["micah", "mic"] },
  { id: 34, name: "Nahum", chapters: 3, aliases: ["nahum", "nah"] },
  { id: 35, name: "Habakkuk", chapters: 3, aliases: ["habakkuk", "hab"] },
  { id: 36, name: "Zephaniah", chapters: 3, aliases: ["zephaniah", "zeph"] },
  { id: 37, name: "Haggai", chapters: 2, aliases: ["haggai", "hag"] },
  { id: 38, name: "Zechariah", chapters: 14, aliases: ["zechariah", "zech"] },
  { id: 39, name: "Malachi", chapters: 4, aliases: ["malachi", "mal"] },
  { id: 40, name: "Matthew", chapters: 28, aliases: ["matthew", "matt", "mat"] },
  { id: 41, name: "Mark", chapters: 16, aliases: ["mark", "mrk"] },
  { id: 42, name: "Luke", chapters: 24, aliases: ["luke", "luk"] },
  { id: 43, name: "John", chapters: 21, aliases: ["john", "jhn"] },
  { id: 44, name: "Acts", chapters: 28, aliases: ["acts", "act"] },
  { id: 45, name: "Romans", chapters: 16, aliases: ["romans", "rom"] },
  { id: 46, name: "1 Corinthians", chapters: 16, aliases: ["1 corinthians", "first corinthians", "1st corinthians", "i corinthians", "1 cor"] },
  { id: 47, name: "2 Corinthians", chapters: 13, aliases: ["2 corinthians", "second corinthians", "2nd corinthians", "ii corinthians", "2 cor"] },
  { id: 48, name: "Galatians", chapters: 6, aliases: ["galatians", "gal"] },
  { id: 49, name: "Ephesians", chapters: 6, aliases: ["ephesians", "eph"] },
  { id: 50, name: "Philippians", chapters: 4, aliases: ["philippians", "phil"] },
  { id: 51, name: "Colossians", chapters: 4, aliases: ["colossians", "col"] },
  { id: 52, name: "1 Thessalonians", chapters: 5, aliases: ["1 thessalonians", "first thessalonians", "1st thessalonians", "i thessalonians", "1 thess"] },
  { id: 53, name: "2 Thessalonians", chapters: 3, aliases: ["2 thessalonians", "second thessalonians", "2nd thessalonians", "ii thessalonians", "2 thess"] },
  { id: 54, name: "1 Timothy", chapters: 6, aliases: ["1 timothy", "first timothy", "1st timothy", "i timothy", "1 tim"] },
  { id: 55, name: "2 Timothy", chapters: 4, aliases: ["2 timothy", "second timothy", "2nd timothy", "ii timothy", "2 tim"] },
  { id: 56, name: "Titus", chapters: 3, aliases: ["titus"] },
  { id: 57, name: "Philemon", chapters: 1, aliases: ["philemon", "phlm"] },
  { id: 58, name: "Hebrews", chapters: 13, aliases: ["hebrews", "heb"] },
  { id: 59, name: "James", chapters: 5, aliases: ["james", "jas"] },
  { id: 60, name: "1 Peter", chapters: 5, aliases: ["1 peter", "first peter", "1st peter", "i peter", "1 pet"] },
  { id: 61, name: "2 Peter", chapters: 3, aliases: ["2 peter", "second peter", "2nd peter", "ii peter", "2 pet"] },
  { id: 62, name: "1 John", chapters: 5, aliases: ["1 john", "first john", "1st john", "i john"] },
  { id: 63, name: "2 John", chapters: 1, aliases: ["2 john", "second john", "2nd john", "ii john"] },
  { id: 64, name: "3 John", chapters: 1, aliases: ["3 john", "third john", "3rd john", "iii john"] },
  { id: 65, name: "Jude", chapters: 1, aliases: ["jude"] },
  { id: 66, name: "Revelation", chapters: 22, aliases: ["revelation", "revelations", "rev"] },
];

// Longest alias first so "song of solomon" matches before "song", etc.
const ALIAS_LOOKUP = [];
for (const book of BOOKS) {
  for (const alias of book.aliases) {
    ALIAS_LOOKUP.push({ alias, book });
  }
}
ALIAS_LOOKUP.sort((a, b) => b.alias.length - a.alias.length);

function findBookByAlias(text) {
  const normalized = text.toLowerCase().trim();
  for (const { alias, book } of ALIAS_LOOKUP) {
    if (normalized === alias) return book;
  }
  return null;
}

function bookById(id) {
  return BOOKS.find((b) => b.id === id) || null;
}

module.exports = { BOOKS, ALIAS_LOOKUP, findBookByAlias, bookById };
