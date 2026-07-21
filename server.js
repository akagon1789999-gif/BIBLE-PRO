require("dotenv").config();
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("./lib/db");
const { createSession, parseTranscript } = require("./lib/referenceParser");
const {
  fetchVerseText,
  fetchVerseRange,
  fetchChapter,
  listEnglishTranslations,
  POPULAR_TRANSLATION_CODES,
} = require("./lib/bollsClient");
const { BOOKS, bookById, findBookByAlias } = require("./lib/books");
const { createBufferState, clearBuffer, findParaphraseMatch } = require("./lib/paraphraseMatcher");
const deepgram = require("./lib/deepgramSession");
const offlineWhisper = require("./lib/offlineWhisper");
const obsClient = require("./lib/obsClient");
const { sanitizeCustomTextHtml, normalizeFontSize } = require("./lib/richText");
const sermonLog = require("./lib/sermonLog");
const { buildTranscriptText, buildTranscriptPdf } = require("./lib/sermonExport");
const PDFDocument = require("pdfkit");
const {
  PRESETS: BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND,
  MOTION_DIR,
  MOTION_URL_PREFIX,
  listMotionBackgrounds,
  normalizeBackground,
} = require("./lib/backgrounds");
const mediaLibrary = require("./lib/mediaLibrary");

const PORT = process.env.PORT || 3000;
const TRANSLATION = process.env.TRANSLATION || "KJV";
const SUGGESTION_DEDUPE_MS = 20 * 1000;
// Used both for the "are we still online?" probe while connected, and for
// reconnect attempts while in offline fallback.
const HEALTH_CHECK_INTERVAL_MS = 20 * 1000;

const uploadsDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/;
const VIDEO_MIME_RE = /^video\/(mp4|webm|quicktime)$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB — 4K motion backgrounds run a few hundred MB
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME_RE.test(file.mimetype) || VIDEO_MIME_RE.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPEG, WEBP, GIF images or MP4/WEBM/MOV videos are allowed."));
  },
});

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(MOTION_URL_PREFIX, express.static(MOTION_DIR));

app.get("/api/backgrounds", (req, res) => {
  const dbMotion = mediaLibrary.listAssets("motion").map((a) => ({ id: a.id, label: a.label, type: "video", url: a.url }));
  const uploads = mediaLibrary
    .listAssets("background")
    .map((a) => ({ id: a.id, label: a.label, type: a.kind, url: a.url }));
  res.json({ presets: BACKGROUND_PRESETS, motion: [...listMotionBackgrounds(), ...dbMotion], uploads });
});

app.post("/api/backgrounds/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const type = VIDEO_MIME_RE.test(req.file.mimetype) ? "video" : "image";
  const asset = mediaLibrary.createAsset({
    category: type === "video" ? "motion" : "background",
    kind: type,
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
  });
  res.json({ url: asset.url, type, id: asset.id });
});

app.get("/api/media/:category", (req, res) => {
  const { category } = req.params;
  if (!mediaLibrary.CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category." });
  const dbAssets = mediaLibrary.listAssets(category, req.query.search);
  const folderAssets =
    category === "motion"
      ? listMotionBackgrounds().map((m) => ({ id: m.id, category, kind: "video", label: m.label, url: m.url, deletable: false }))
      : [];
  res.json({ assets: [...folderAssets, ...dbAssets] });
});

app.post("/api/media/:category/upload", upload.single("file"), (req, res) => {
  const { category } = req.params;
  if (!mediaLibrary.CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const kind = VIDEO_MIME_RE.test(req.file.mimetype) ? "video" : "image";
  const asset = mediaLibrary.createAsset({
    category,
    kind,
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
  });
  res.json({ asset });
});

app.delete("/api/media/:id", (req, res) => {
  const deleted = mediaLibrary.deleteAsset(req.params.id, uploadsDir);
  if (!deleted) return res.status(404).json({ error: "Asset not found or not deletable." });
  res.json({ ok: true });
});

app.get("/api/translations", async (req, res) => {
  try {
    res.json({ translations: await listEnglishTranslations(), popular: POPULAR_TRANSLATION_CODES });
  } catch (err) {
    res.status(502).json({ error: `Could not load translations: ${err.message}` });
  }
});

app.get("/api/bible/books", (req, res) => {
  res.json({ books: BOOKS.map((b) => ({ id: b.id, name: b.name, chapters: b.chapters })) });
});

app.get("/api/bible/chapter/:bookId/:chapter", async (req, res) => {
  const book = bookById(parseInt(req.params.bookId, 10));
  const chapter = parseInt(req.params.chapter, 10);
  if (!book || !chapter || chapter < 1 || chapter > book.chapters) {
    return res.status(400).json({ error: "Invalid book or chapter." });
  }
  const translation = req.query.translation || TRANSLATION;
  try {
    const verses = await fetchChapter(book.id, chapter, translation);
    res.json({ bookId: book.id, bookName: book.name, chapter, translation, verses });
  } catch (err) {
    res.status(502).json({ error: `Could not load chapter: ${err.message}` });
  }
});

app.get("/api/obs/status", async (req, res) => {
  res.json(await obsClient.getStatus());
});

function exportFilename(ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `sermon-${stamp}.${ext}`;
}

app.get("/api/export/transcript.txt", (req, res) => {
  const body = buildTranscriptText(sermonLog.getLog());
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("txt")}"`);
  res.send(body);
});

app.get("/api/export/transcript.pdf", (req, res) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("pdf")}"`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  buildTranscriptPdf(doc, sermonLog.getLog());
  doc.end();
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || "Upload failed." });
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const displayClients = new Set();
const operatorState = new Map(); // ws -> { session, pending: Map<id, suggestion>, recent: Map<key, ts> }
let currentBackground = DEFAULT_BACKGROUND;
let currentShow = null; // last {type:"show", ...} payload broadcast, or null if the display is cleared

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// Sends to the projector display AND every operator dashboard, so an
// operator's "now showing" preview always mirrors exactly what's on screen —
// regardless of which operator tab (or manual entry) triggered the change.
function broadcastState(msg) {
  const data = JSON.stringify(msg);
  for (const ws of displayClients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
  for (const ws of operatorState.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function dedupeKey(s) {
  return `${s.bookId}:${s.chapter}:${s.verse}`;
}

function formatVerseRef(s) {
  if (s.isChapterOnly) return `${s.bookName} ${s.chapter}`;
  return s.verseEnd ? `${s.bookName} ${s.chapter}:${s.verse}-${s.verseEnd}` : `${s.bookName} ${s.chapter}:${s.verse}`;
}

function pruneRecent(recent, now) {
  for (const [key, ts] of recent) {
    if (now - ts > SUGGESTION_DEDUPE_MS * 3) recent.delete(key);
  }
}

async function handleTranscriptFinal(ws, state, text) {
  send(ws, { type: "final", text });
  sermonLog.recordTranscript(text);

  const now = Date.now();
  pruneRecent(state.recent, now);
  const rawSuggestions = parseTranscript(text, state.session, now);

  if (rawSuggestions.length > 0) {
    // An explicit reference was heard — drop any accumulated paraphrase buffer
    // so stale speech doesn't bleed into the next semantic search.
    clearBuffer(state.buffer);
  } else {
    const match = await findParaphraseMatch(state.buffer, text, now, TRANSLATION);
    if (match) rawSuggestions.push(match);
  }

  for (const s of rawSuggestions) {
    const key = dedupeKey(s);
    const lastSeen = state.recent.get(key);
    if (lastSeen && now - lastSeen < SUGGESTION_DEDUPE_MS) continue;
    state.recent.set(key, now);

    let verseText = s.text || null;
    if (!verseText) {
      try {
        const result = await fetchVerseText(s.bookId, s.chapter, s.verse, TRANSLATION);
        verseText = result ? result.text : null;
      } catch (err) {
        console.error("Bolls lookup failed:", err.message);
      }
    }

    const id = crypto.randomUUID();
    const suggestion = { id, ...s, translation: TRANSLATION, text: verseText, createdAt: now };

    if (state.mode === "auto") {
      currentShow = { type: "show", ...suggestion };
      broadcastState(currentShow);
      sermonLog.recordVerse({ ref: formatVerseRef(suggestion), translation: suggestion.translation, text: suggestion.text });
    } else {
      state.pending.set(id, suggestion);
      send(ws, { type: "suggestion", suggestion });
    }
  }
}

// Returns true if a live Deepgram session is now running. Never throws —
// connection failures are just reported back via the boolean so callers can
// fall back to the offline engine.
async function tryConnectDeepgram(ws, state) {
  if (!deepgram.isConfigured()) return false;
  try {
    const connection = await deepgram.startSession({
      onFinal: (text) => {
        handleTranscriptFinal(ws, state, text).catch((err) =>
          console.error("handleTranscriptFinal failed:", err.message)
        );
      },
      onInterim: (text) => send(ws, { type: "interim", text }),
      onError: (err) => {
        console.error("Deepgram error:", err && err.message ? err.message : err);
      },
      onClose: () => {
        if (state.deepgram === connection) {
          state.deepgram = null;
          state.deepgramReady = false;
          // Dropped mid-session (not a deliberate Stop Listening) — fall back.
          if (state.listeningRequested) enterOfflineMode(ws, state);
        }
      },
    });

    state.deepgram = connection;
    state.deepgramReady = true;
    for (const chunk of state.audioQueue) connection.sendMedia(chunk);
    state.audioQueue = [];
    return true;
  } catch (err) {
    console.error("Failed to start Deepgram session:", err.message);
    return false;
  }
}

// Deepgram's SDK only tells us about a dead connection reactively (onClose/
// onError) — but flipping off Wi-Fi doesn't necessarily error an already-open
// TCP socket right away; the OS can take a long time to notice. So this
// actively probes connectivity on a timer instead of just waiting to be told.
const CONNECTIVITY_CHECK_TIMEOUT_MS = 4 * 1000;

async function isInternetReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_CHECK_TIMEOUT_MS);
  try {
    await fetch("https://api.deepgram.com/", { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function startHealthTimer(ws, state) {
  if (state.healthTimer) return;
  state.healthTimer = setInterval(async () => {
    if (!state.listeningRequested) return;

    if (state.sttMode === "online") {
      const reachable = await isInternetReachable();
      if (!reachable && state.listeningRequested && state.sttMode === "online") {
        console.warn("Health check: internet unreachable — forcing offline fallback.");
        if (state.deepgram) {
          try {
            state.deepgram.close();
          } catch {
            /* already closed */
          }
          state.deepgram = null;
          state.deepgramReady = false;
        }
        enterOfflineMode(ws, state);
      }
    } else if (state.sttMode === "offline") {
      const connected = await tryConnectDeepgram(ws, state);
      if (connected) exitOfflineMode(ws, state);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthTimer(state) {
  if (state.healthTimer) {
    clearInterval(state.healthTimer);
    state.healthTimer = null;
  }
}

function enterOfflineMode(ws, state) {
  if (state.sttMode === "offline") return;
  if (!offlineWhisper.isAvailable()) {
    send(ws, {
      type: "error",
      message: "Lost connection to Deepgram, and no offline speech engine is installed. Speech recognition is paused.",
    });
    return;
  }
  state.sttMode = "offline";
  send(ws, { type: "stt-mode", mode: "offline" });
}

function exitOfflineMode(ws, state) {
  if (state.sttMode !== "offline") return;
  state.sttMode = "online";
  send(ws, { type: "stt-mode", mode: "online" });
}

async function startDeepgramForOperator(ws, state) {
  state.listeningRequested = true;
  if (state.deepgram) return; // already running

  const connected = await tryConnectDeepgram(ws, state);
  startHealthTimer(ws, state);
  if (connected) {
    exitOfflineMode(ws, state);
    return;
  }

  if (offlineWhisper.isAvailable()) {
    enterOfflineMode(ws, state);
  } else {
    send(ws, {
      type: "error",
      message: deepgram.isConfigured()
        ? "Could not reach Deepgram, and no offline speech engine is installed. Speech recognition is unavailable."
        : "Server is not configured with a Deepgram API key, and no offline speech engine is installed.",
    });
  }
}

function stopDeepgramForOperator(state) {
  state.listeningRequested = false;
  stopHealthTimer(state);
  if (state.deepgram) {
    try {
      state.deepgram.close();
    } catch {
      /* already closed */
    }
  }
  state.deepgram = null;
  state.deepgramReady = false;
  state.audioQueue = [];
  state.sttMode = "online";
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get("role") || "operator";

  if (role === "display") {
    displayClients.add(ws);
    send(ws, { type: "background", background: currentBackground });
    if (currentShow) send(ws, currentShow);
    ws.on("close", () => displayClients.delete(ws));
    return;
  }

  const state = {
    session: createSession(),
    pending: new Map(),
    recent: new Map(),
    buffer: createBufferState(),
    deepgram: null,
    deepgramReady: false,
    audioQueue: [],
    mode: "manual", // "manual" = suggestions wait for Approve; "auto" = shown immediately
    sttMode: "online", // "online" = Deepgram; "offline" = local whisper.cpp fallback
    listeningRequested: false,
    healthTimer: null, // periodic connectivity probe + offline->online reconnect attempts
  };
  operatorState.set(ws, state);
  send(ws, { type: "background", background: currentBackground });
  if (currentShow) send(ws, currentShow);

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) {
      if (state.deepgramReady && state.deepgram) {
        try {
          state.deepgram.sendMedia(raw);
        } catch (err) {
          console.error("Deepgram sendMedia failed:", err.message);
        }
      } else {
        state.audioQueue.push(raw);
        if (state.audioQueue.length > 200) state.audioQueue.shift(); // cap in case the connection never opens
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "start-audio") {
      obsClient.startRecording().catch(() => {}); // best-effort — never blocks speech recognition starting
      await startDeepgramForOperator(ws, state);
      return;
    }

    if (msg.type === "stop-audio") {
      obsClient.stopRecording().catch(() => {});
      stopDeepgramForOperator(state);
      return;
    }

    if (msg.type === "set-mode" && (msg.mode === "auto" || msg.mode === "manual")) {
      state.mode = msg.mode;
      return;
    }

    if (msg.type === "obs-switch-scene" && typeof msg.sceneName === "string") {
      obsClient.setScene(msg.sceneName).catch((err) => console.error("OBS scene switch failed:", err.message));
      return;
    }

    // A ~5s WAV segment recorded client-side while offline (see operator.js's
    // Web Audio API capture) — transcribed locally and fed through the exact
    // same pipeline Deepgram's finals use, so verse detection just keeps working.
    if (msg.type === "offline-audio" && typeof msg.audioBase64 === "string") {
      if (state.sttMode !== "offline") return; // stale segment from just before reconnecting
      try {
        const wavBuffer = Buffer.from(msg.audioBase64, "base64");
        const text = await offlineWhisper.transcribeWavBuffer(wavBuffer);
        if (text) await handleTranscriptFinal(ws, state, text);
      } catch (err) {
        console.error("Offline transcription failed:", err.message);
      }
      return;
    }

    if (msg.type === "transcript" && msg.isFinal && typeof msg.text === "string" && msg.text.trim()) {
      await handleTranscriptFinal(ws, state, msg.text.trim());
      return;
    }

    if (msg.type === "approve" && msg.id) {
      const suggestion = state.pending.get(msg.id);
      if (suggestion) {
        currentShow = { type: "show", ...suggestion };
        broadcastState(currentShow);
        state.pending.delete(msg.id);
        sermonLog.recordVerse({ ref: formatVerseRef(suggestion), translation: suggestion.translation, text: suggestion.text });
      }
      return;
    }

    if (msg.type === "reject" && msg.id) {
      state.pending.delete(msg.id);
      return;
    }

    if (msg.type === "switch-translation" && msg.id && typeof msg.translation === "string") {
      const suggestion = state.pending.get(msg.id);
      if (suggestion) {
        try {
          const result = suggestion.verseEnd
            ? await fetchVerseRange(suggestion.bookId, suggestion.chapter, suggestion.verse, suggestion.verseEnd, msg.translation)
            : await fetchVerseText(suggestion.bookId, suggestion.chapter, suggestion.verse, msg.translation);
          const updated = { ...suggestion, translation: msg.translation, text: result ? result.text : null };
          state.pending.set(msg.id, updated);
          send(ws, { type: "suggestion", suggestion: updated });
        } catch (err) {
          send(ws, { type: "error", message: `Translation lookup failed: ${err.message}` });
        }
      }
      return;
    }

    // Switches the translation of whatever is currently live on the projector
    // (as opposed to switch-translation, which is for a pending suggestion
    // card that hasn't been approved yet).
    if (msg.type === "switch-live-translation" && typeof msg.translation === "string") {
      if (currentShow && currentShow.type === "show" && !currentShow.custom && currentShow.bookId) {
        try {
          const result = currentShow.verseEnd
            ? await fetchVerseRange(currentShow.bookId, currentShow.chapter, currentShow.verse, currentShow.verseEnd, msg.translation)
            : await fetchVerseText(currentShow.bookId, currentShow.chapter, currentShow.verse, msg.translation);
          currentShow = { ...currentShow, translation: msg.translation, text: result ? result.text : null };
          broadcastState(currentShow);
        } catch (err) {
          send(ws, { type: "error", message: `Translation lookup failed: ${err.message}` });
        }
      }
      return;
    }

    if (msg.type === "clear") {
      currentShow = null;
      broadcastState({ type: "clear" });
      return;
    }

    if (msg.type === "set-background") {
      currentBackground = normalizeBackground(msg.background);
      broadcastState({ type: "background", background: currentBackground });
      return;
    }

    if (msg.type === "manual") {
      const book = bookById(msg.bookId) || findBookByAlias(msg.bookName || "");
      const chapter = parseInt(msg.chapter, 10);
      const verse = parseInt(msg.verse, 10);
      const verseEndRaw = msg.verseEnd ? parseInt(msg.verseEnd, 10) : null;
      const verseEnd = verseEndRaw && verseEndRaw > verse ? verseEndRaw : null;
      if (book && chapter && verse) {
        try {
          const result = verseEnd
            ? await fetchVerseRange(book.id, chapter, verse, verseEnd, TRANSLATION)
            : await fetchVerseText(book.id, chapter, verse, TRANSLATION);
          const suggestion = {
            id: crypto.randomUUID(),
            bookId: book.id,
            bookName: book.name,
            chapter,
            verse,
            verseEnd: verseEnd || undefined,
            isChapterOnly: false,
            source: "manual",
            translation: TRANSLATION,
            text: result ? result.text : null,
            createdAt: Date.now(),
          };
          suggestion.raw = formatVerseRef(suggestion);
          currentShow = { type: "show", ...suggestion };
          broadcastState(currentShow);
          sermonLog.recordVerse({ ref: suggestion.raw, translation: suggestion.translation, text: suggestion.text });
        } catch (err) {
          send(ws, { type: "error", message: `Lookup failed: ${err.message}` });
        }
      }
      return;
    }

    if (msg.type === "custom-text" && typeof msg.html === "string") {
      const html = sanitizeCustomTextHtml(msg.html).slice(0, 4000);
      if (!html) return;
      currentShow = {
        type: "show",
        id: crypto.randomUUID(),
        custom: true,
        html,
        fontSize: normalizeFontSize(msg.fontSize),
        createdAt: Date.now(),
      };
      broadcastState(currentShow);
      return;
    }
  });

  ws.on("close", () => {
    stopDeepgramForOperator(state);
    operatorState.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Projector Bible server running at http://localhost:${PORT}`);
  console.log(`  Operator console: http://localhost:${PORT}/operator.html`);
  console.log(`  Display output:   http://localhost:${PORT}/display.html`);
  console.log(`  Database:         ${db.name}`);
});
