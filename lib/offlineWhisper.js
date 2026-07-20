const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Local speech-to-text fallback for when Deepgram is unreachable. Built on
// nodejs-whisper (a Node binding for whisper.cpp) so nothing here needs a
// separate Python process. It's an *optional* dependency (see package.json)
// — if it's not installed, or the model was never downloaded (needs
// internet the first time — see `npm run setup:offline-stt`), offline
// fallback is simply unavailable and the app runs Deepgram-only, same as
// before this feature existed.
const MODEL_NAME = process.env.WHISPER_MODEL || "base.en";

let nodewhisperFn = null;
try {
  ({ nodewhisper: nodewhisperFn } = require("nodejs-whisper"));
} catch {
  // Not installed — expected on hosts (e.g. Railway) that skipped this
  // optional dependency, or never ran the setup script.
}

function isAvailable() {
  return typeof nodewhisperFn === "function";
}

// Transcribes a raw WAV file buffer and returns plain text, or null if
// nothing intelligible came out (silence, noise-only segment, etc).
async function transcribeWavBuffer(wavBuffer) {
  if (!isAvailable()) throw new Error("Offline speech engine is not installed.");

  const tmpPath = path.join(os.tmpdir(), `projector-bible-offline-${crypto.randomUUID()}.wav`);
  fs.writeFileSync(tmpPath, wavBuffer);

  try {
    const raw = await nodewhisperFn(tmpPath, {
      modelName: MODEL_NAME,
      removeWavFileAfterTranscription: false, // we remove it ourselves below
      whisperOptions: {
        outputInText: false,
        outputInSrt: false,
        splitOnWord: true,
      },
    });
    return cleanTranscript(raw);
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
}

// whisper.cpp's raw output is SRT-style lines like:
// "[00:00:00.000 --> 00:00:04.240]   For God so loved the world..."
// Strip the timestamps down to plain spoken text.
function cleanTranscript(raw) {
  if (!raw) return null;
  const text = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

module.exports = { isAvailable, transcribeWavBuffer, MODEL_NAME };
