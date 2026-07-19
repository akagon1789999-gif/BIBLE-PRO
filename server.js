require("dotenv").config();
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { createSession, parseTranscript } = require("./lib/referenceParser");
const { fetchVerseText } = require("./lib/bollsClient");
const { bookById, findBookByAlias } = require("./lib/books");
const { createBufferState, clearBuffer, findParaphraseMatch } = require("./lib/paraphraseMatcher");
const deepgram = require("./lib/deepgramSession");
const { sanitizeCustomTextHtml, normalizeFontSize } = require("./lib/richText");
const {
  PRESETS: BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND,
  MOTION_DIR,
  MOTION_URL_PREFIX,
  listMotionBackgrounds,
  normalizeBackground,
} = require("./lib/backgrounds");

const PORT = process.env.PORT || 3000;
const TRANSLATION = process.env.TRANSLATION || "KJV";
const SUGGESTION_DEDUPE_MS = 20 * 1000;

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
  res.json({ presets: BACKGROUND_PRESETS, motion: listMotionBackgrounds() });
});

app.post("/api/backgrounds/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const type = VIDEO_MIME_RE.test(req.file.mimetype) ? "video" : "image";
  res.json({ url: `/uploads/${req.file.filename}`, type });
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

function pruneRecent(recent, now) {
  for (const [key, ts] of recent) {
    if (now - ts > SUGGESTION_DEDUPE_MS * 3) recent.delete(key);
  }
}

async function handleTranscriptFinal(ws, state, text) {
  send(ws, { type: "final", text });

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
    state.pending.set(id, suggestion);
    send(ws, { type: "suggestion", suggestion });
  }
}

async function startDeepgramForOperator(ws, state) {
  if (state.deepgram) return; // already running
  if (!deepgram.isConfigured()) {
    send(ws, { type: "error", message: "Server is not configured with a Deepgram API key." });
    return;
  }

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
        send(ws, { type: "error", message: "Speech recognition error." });
      },
      onClose: () => {
        if (state.deepgram === connection) {
          state.deepgram = null;
          state.deepgramReady = false;
        }
      },
    });

    state.deepgram = connection;
    state.deepgramReady = true;
    for (const chunk of state.audioQueue) connection.sendMedia(chunk);
    state.audioQueue = [];
  } catch (err) {
    console.error("Failed to start Deepgram session:", err.message);
    send(ws, { type: "error", message: "Could not start speech recognition." });
  }
}

function stopDeepgramForOperator(state) {
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
      await startDeepgramForOperator(ws, state);
      return;
    }

    if (msg.type === "stop-audio") {
      stopDeepgramForOperator(state);
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
      }
      return;
    }

    if (msg.type === "reject" && msg.id) {
      state.pending.delete(msg.id);
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
      if (book && chapter && verse) {
        try {
          const result = await fetchVerseText(book.id, chapter, verse, TRANSLATION);
          const suggestion = {
            id: crypto.randomUUID(),
            bookId: book.id,
            bookName: book.name,
            chapter,
            verse,
            isChapterOnly: false,
            source: "manual",
            raw: `${book.name} ${chapter}:${verse}`,
            translation: TRANSLATION,
            text: result ? result.text : null,
            createdAt: Date.now(),
          };
          currentShow = { type: "show", ...suggestion };
          broadcastState(currentShow);
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
});
