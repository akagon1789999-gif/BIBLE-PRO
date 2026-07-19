const { DeepgramClient } = require("@deepgram/sdk");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || "en";

const client = DEEPGRAM_API_KEY ? new DeepgramClient({ apiKey: DEEPGRAM_API_KEY }) : null;

function isConfigured() {
  return Boolean(client);
}

/**
 * Opens a live Deepgram transcription session and wires its results into the
 * given callbacks. Audio encoding is intentionally left unspecified —
 * Deepgram auto-detects the container/codec from the stream's header, which
 * is what lets this work directly with Chrome's MediaRecorder output
 * (audio/webm;codecs=opus) with no client-side transcoding.
 *
 * @returns the live connection: call `.sendMedia(chunk)` per audio chunk and
 *          `.close()` when done.
 */
async function startSession({ onFinal, onInterim, onError, onClose }) {
  if (!client) throw new Error("DEEPGRAM_API_KEY is not set");

  const connection = await client.listen.v1.connect({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
  });

  connection.on("message", (data) => {
    if (data.type !== "Results") return;
    const alt = data.channel && data.channel.alternatives && data.channel.alternatives[0];
    const text = alt ? alt.transcript.trim() : "";
    if (!text) return;
    if (data.is_final) onFinal(text);
    else onInterim(text);
  });

  connection.on("error", (err) => onError(err));
  connection.on("close", () => onClose());

  connection.connect();
  await connection.waitForOpen();

  return connection;
}

module.exports = { isConfigured, startSession };
