#!/usr/bin/env node
// Run once, while online: `npm run setup:offline-stt`
// Downloads the offline Whisper model and compiles whisper.cpp so the
// fallback in lib/offlineWhisper.js actually works once the internet is
// gone (the model can't be fetched after the fact — that's the whole
// point of doing this ahead of time).
const fs = require("fs");
const os = require("os");
const path = require("path");

const MODEL = process.env.WHISPER_MODEL || "base.en";

// A minimal valid silent WAV — just needs to be a well-formed audio file to
// drive the download+build; its content is irrelevant.
function writeSilentWav(filePath, seconds = 1, sampleRate = 16000) {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
}

(async () => {
  let nodewhisper;
  try {
    ({ nodewhisper } = require("nodejs-whisper"));
  } catch {
    console.error(
      "[setup:offline-stt] nodejs-whisper isn't installed. It's an optional dependency — " +
        "run `npm install` again and check for build errors (it needs make/gcc, and cmake)."
    );
    process.exit(1);
  }

  const tmpWav = path.join(os.tmpdir(), "projector-bible-setup-silence.wav");
  writeSilentWav(tmpWav);

  console.log(`[setup:offline-stt] Preparing offline model "${MODEL}" — this compiles whisper.cpp and`);
  console.log("[setup:offline-stt] downloads the model file. Needs internet now; won't need it again.");

  try {
    await nodewhisper(tmpWav, {
      modelName: MODEL,
      autoDownloadModelName: MODEL,
      removeWavFileAfterTranscription: true,
      whisperOptions: { noGpu: false },
    });
    console.log(`[setup:offline-stt] Done. Offline fallback ("${MODEL}") is ready even without internet.`);
  } catch (err) {
    console.error("[setup:offline-stt] Failed:", err.message);
    process.exit(1);
  } finally {
    fs.rm(tmpWav, { force: true }, () => {});
  }
})();
