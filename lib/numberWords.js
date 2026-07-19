// Builds a spoken-number -> integer lookup (0-199, enough for any chapter/verse
// in the Bible) so the parser can catch "verse sixteen" as well as "verse 16".
// Chrome's Web Speech API usually emits digits already, but this is a safety net.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberToWordForms(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    if (o === 0) return [t];
    return [`${t}-${ONES[o]}`, `${t} ${ONES[o]}`];
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const hWord = `${ONES[hundreds]} hundred`;
  if (rest === 0) return [hWord];
  const restForms = numberToWordForms(rest);
  const forms = [];
  for (const r of restForms) {
    forms.push(`${hWord} and ${r}`, `${hWord} ${r}`);
  }
  return forms;
}

const WORD_TO_NUMBER = {};
for (let n = 0; n <= 199; n++) {
  for (const form of numberToWordForms(n)) {
    WORD_TO_NUMBER[form] = n;
  }
}

// Sorted longest-first so "one hundred and fifty" matches before "one".
const NUMBER_WORDS_SORTED = Object.keys(WORD_TO_NUMBER).sort((a, b) => b.length - a.length);

function wordToNumber(str) {
  const key = str.toLowerCase().trim();
  if (/^\d{1,3}$/.test(key)) return parseInt(key, 10);
  return Object.prototype.hasOwnProperty.call(WORD_TO_NUMBER, key) ? WORD_TO_NUMBER[key] : null;
}

module.exports = { WORD_TO_NUMBER, NUMBER_WORDS_SORTED, wordToNumber };
