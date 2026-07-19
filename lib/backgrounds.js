const fs = require("fs");
const path = require("path");

// Built-in projector background presets. Kept as plain CSS `background`
// shorthand values so the server and the display page can share one
// definition without any image assets to host.
const PRESETS = [
  { id: "classic-black", label: "Classic Black", css: "#000000" },
  { id: "charcoal", label: "Charcoal", css: "#14161b" },
  { id: "deep-blue", label: "Deep Blue", css: "linear-gradient(160deg, #0b1a33, #030712)" },
  { id: "midnight-purple", label: "Midnight Purple", css: "linear-gradient(160deg, #24143a, #0a0512)" },
  { id: "warm-sunset", label: "Warm Sunset", css: "linear-gradient(160deg, #4a1d2b, #17090c)" },
  { id: "forest", label: "Forest", css: "linear-gradient(160deg, #10241c, #060d0a)" },
];

const DEFAULT_BACKGROUND = { type: "preset", id: PRESETS[0].id, css: PRESETS[0].css };

const UPLOADS_URL_PREFIX = "/uploads/";

// A folder of ready-made motion (video) backgrounds. Any video dropped in
// here shows up automatically in the operator's background picker — no
// upload needed. Overridable since this defaults to a path specific to this
// deployment's machine.
const MOTION_DIR = process.env.MOTION_BACKGROUNDS_DIR || "/Users/theunitychurch/Documents/STUDIO/images";
const MOTION_URL_PREFIX = "/motion-backgrounds/";
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function listMotionBackgrounds() {
  let entries;
  try {
    entries = fs.readdirSync(MOTION_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => ({
      id: `motion:${name}`,
      label: path.basename(name, path.extname(name)).replace(/[_-]+/g, " "),
      type: "video",
      url: `${MOTION_URL_PREFIX}${encodeURIComponent(name)}`,
    }));
}

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

function isTrustedMediaUrl(url) {
  return typeof url === "string" && (url.startsWith(UPLOADS_URL_PREFIX) || url.startsWith(MOTION_URL_PREFIX));
}

// Never trust a background object from a client message directly — always
// pass it through this before broadcasting or storing.
function normalizeBackground(input) {
  if (input && (input.type === "image" || input.type === "video") && isTrustedMediaUrl(input.url)) {
    return { type: input.type, url: input.url };
  }
  const preset = presetById(input && input.id) || PRESETS[0];
  return { type: "preset", id: preset.id, css: preset.css };
}

module.exports = {
  PRESETS,
  DEFAULT_BACKGROUND,
  MOTION_DIR,
  MOTION_URL_PREFIX,
  listMotionBackgrounds,
  normalizeBackground,
};
