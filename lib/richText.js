const sanitizeHtml = require("sanitize-html");

// The operator's Custom Text box is a contenteditable div driven by
// document.execCommand('bold'/'italic'/'underline'), so Chrome may emit any
// of <b>/<strong>, <i>/<em>, <u>, or inline font-weight/style/text-decoration
// on <span>/<div>. Allow exactly that surface and nothing else — no <script>,
// <img>, <a>, event handler attributes, or arbitrary CSS.
const SANITIZE_OPTIONS = {
  allowedTags: ["b", "strong", "i", "em", "u", "br", "div", "span"],
  allowedAttributes: {
    span: ["style"],
    div: ["style"],
  },
  allowedStyles: {
    "*": {
      "font-weight": [/^bold$/, /^[1-9]00$/],
      "font-style": [/^italic$/],
      "text-decoration": [/^underline$/, /^underline line-through$/, /^line-through underline$/],
    },
  },
  disallowedTagsMode: "discard",
};

const FONT_SIZES = new Set(["small", "normal", "large", "xlarge"]);

function sanitizeCustomTextHtml(html) {
  return sanitizeHtml(typeof html === "string" ? html : "", SANITIZE_OPTIONS).trim();
}

function normalizeFontSize(size) {
  return FONT_SIZES.has(size) ? size : "normal";
}

module.exports = { sanitizeCustomTextHtml, normalizeFontSize, FONT_SIZES };
