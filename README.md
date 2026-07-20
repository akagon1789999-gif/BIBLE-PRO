# Projector Bible

An AI-powered Scripture Projection Assistant. It listens to a pastor's live
speech, detects Bible references as they're spoken, looks the verse up, and
lets an operator approve it with one click before it appears on the
projector/TV.

## How it works

```
Operator's browser (mic) --MediaRecorder--> audio chunks (WebSocket, binary)
        |
        v
   server.js --relays audio--> Deepgram (live transcription)
        |                              |
        |                     final/interim transcript
        v                              |
   reference parser <-------------------
        |
        v
   Bolls Bible API lookup --> Suggestion card shown to operator
                                     |
                                     v (operator clicks Approve)
                        WebSocket broadcast --> Display page (projector/TV)
```

- **Speech-to-text**: [Deepgram](https://deepgram.com)'s live streaming API
  (`nova-3` model). The operator's browser captures mic audio with
  `MediaRecorder` and streams it to `server.js` over the WebSocket; the
  server relays it to Deepgram and gets back interim/final transcripts. The
  Deepgram API key lives only in `.env` on the server — it's never sent to
  the browser.
- **Manual / Auto mode**: a toggle in the header controls what happens when
  a verse is detected from speech. **Manual** (default) queues it as a card
  in Verse Suggestions for you to Approve or Reject. **Auto** skips the
  queue entirely and puts it straight on the projector. This only affects
  speech-detected suggestions — manual entry and Custom Text always go
  straight to the display regardless of mode, since typing/clicking those
  already *is* the approval. The mode is per-connection (not shared across
  operator tabs) and re-syncs itself after any reconnect.
- **Reference detection**: [`lib/referenceParser.js`](lib/referenceParser.js)
  — regex + a small state machine that catches explicit refs ("John 3:16"),
  trigger phrases ("turn to...", "open your Bible to...", "let's look at..."),
  and references spoken across multiple sentences ("Romans..." ... "chapter
  8" ... "verse 1").
- **Paraphrase detection**: [`lib/paraphraseMatcher.js`](lib/paraphraseMatcher.js)
  — when a chunk of speech contains no explicit reference, it's added to a
  rolling ~15s buffer and, once there's enough substance, run through Bolls'
  semantic (vector) search. A local word-overlap score
  ([`lib/textSimilarity.js`](lib/textSimilarity.js)) filters the top result
  before it's ever shown to the operator — calibrated against live testing
  where real paraphrases scored ~0.43 and unrelated sermon chit-chat topped
  out at ~0.10. This is what catches a verse quoted in the pastor's own
  words, without a chapter:verse citation.
- **Bible text**: the free [Bolls Bible API](https://bolls.life) — no
  hosting, no licensing, defaults to the public-domain KJV.
- **Translation switching**: every translation dropdown (suggestion cards,
  and the live one in Projector Preview) lists AMP/KJV/NKJV/ESV/NIV/NASB/
  NLT/ASV/MSG/ISV directly, with the other 30 English translations Bolls
  offers tucked under a "More" group. Switching a **suggestion card's**
  dropdown re-fetches that verse and updates the card in place before you
  approve it. Switching the **Projector Preview's** dropdown re-fetches
  whatever's *currently live on the projector* and updates it in real
  time — the congregation sees the translation change immediately, no
  re-approval needed. Some translations (NIV, ESV, etc.) are copyrighted —
  see the licensing note under Configuration.
- **Display**: a separate fullscreen page you drag to the projector/TV's
  screen; it only updates when the operator approves a suggestion.
- **Backgrounds**: [`lib/backgrounds.js`](lib/backgrounds.js) — six built-in
  gradient/solid-color presets, plus custom image *and video* (motion)
  backgrounds, picked from a swatch bar in the operator console and
  broadcast live to the display. Legibility over any background (including
  busy motion video) comes from a subtitle-style text outline/shadow, not a
  background box — see below.
- **Motion backgrounds**: any video dropped into the folder set by
  `MOTION_BACKGROUNDS_DIR` (default `/Users/theunitychurch/Documents/STUDIO/images`)
  shows up automatically in the swatch bar — no upload needed. You can also
  upload a video directly from the operator console (up to 1GB, MP4/WEBM/MOV).
  Uploaded videos land in `public/uploads/` (gitignored); library videos are
  served straight from their original folder, so nothing gets duplicated on
  disk.
- **Operator preview**: the operator console shows a small live preview of
  exactly what's on the projector — same background, same verse text. The
  server (not the browser) is the source of truth for "what's currently
  showing," so every operator tab and the display itself always agree, even
  if you run more than one operator console at once.
- **Custom text formatting**: [`lib/richText.js`](lib/richText.js) — the
  Custom Text box is a small rich-text editor (bold/italic/underline, four
  size tiers). It sends real HTML, which the server sanitizes with an
  allowlist (`sanitize-html`) before ever broadcasting it — only
  `b/strong/i/em/u/br/div/span` and the specific style properties those
  commands produce get through, so nothing else in this HTML path is
  trusted at any point. Note: the outline effect behind the text is built
  from layered `text-shadow`, not `-webkit-text-stroke` — Chrome silently
  drops underline rendering when `-webkit-text-stroke` is present, which
  surfaced during testing.
- **Sermon export**: [`lib/sermonLog.js`](lib/sermonLog.js) /
  [`lib/sermonExport.js`](lib/sermonExport.js) — the server keeps a running
  record of every finalized transcript chunk and every verse actually
  approved/shown (not every suggestion) for the current service. **Export
  TXT** / **Export PDF** links next to the Live Transcript panel download
  the full record — a "Scripture References Shown" section followed by the
  full transcript, each timestamped. This log is in-memory and global:
  restarting the server starts a fresh one for the next service.
- **Local audio recording** (frontend-only): every audio chunk captured for
  Deepgram is also kept in the browser's memory. The **Download Audio**
  link (next to Export TXT/PDF) bundles all of it into a `.webm` file and
  downloads it straight from the browser — no server involved, nothing
  uploaded anywhere. Recording accumulates across multiple Start/Stop
  Listening cycles in one page session; reloading the page clears it.
- **Text-to-speech** (frontend-only): the **🔊 Speak** button next to
  Custom Text's Project button reads the typed text aloud using the
  browser's built-in `speechSynthesis` API — useful for proofreading an
  announcement before projecting it. Click again (now "⏹ Stop") to cancel
  mid-sentence.
- **Installable (PWA)**: [`public/sw.js`](public/sw.js) is a minimal
  service worker (caches the static app shell only — API calls, uploads,
  and motion backgrounds always hit the network, so nothing here can ever
  go stale) that, combined with a manifest, makes Chrome treat this as an
  installable app. Operator and Display each get their **own** manifest
  (`manifest-operator.json` / `manifest-display.json`) with their own
  start page, since they're typically installed on different machines —
  the operator console gets a visible **📲 Install App** button in the
  header once Chrome decides the page qualifies; the display page relies
  on Chrome's own address-bar install icon instead, since nothing should
  ever appear as UI chrome on what's actually being projected. Icons live
  in `public/icons/`.

## Setup

Requires [Node.js](https://nodejs.org) 18+, **Google Chrome** (for reliable
`MediaRecorder`/`audio/webm;codecs=opus` support), and a
[Deepgram](https://deepgram.com) API key.

Create a `.env` file in the project root (already gitignored — never commit
this file or share the key elsewhere):

```
DEEPGRAM_API_KEY=your-deepgram-api-key
```

```bash
npm install
npm start
```

Then open, on the same laptop:

- **Operator console**: http://localhost:3000/operator.html
- **Display output**: http://localhost:3000/display.html — drag this window
  onto the projector/TV's screen and make it fullscreen (F11 in Chrome).

## Running on a Sunday

1. Open both pages in Chrome on the booth laptop.
2. Drag the Display window to the extended monitor (projector/TV) and go
   fullscreen.
3. On the Operator console, click **Start Listening** and grant microphone
   access when Chrome asks.
4. Choose **Manual** or **Auto** mode in the header. In Manual (default),
   detected verses appear as cards on the right — click **Approve ▸
   Display** to send one to the screen, or **Reject** to dismiss it. In
   Auto, detected verses go straight to the screen with no card and no
   click needed.
5. Use the **Clear Display** button to blank the screen between verses.
6. If a reference is missed or misheard, type it directly into the manual
   box (e.g. `John 3:16`) and click **Show** — it goes straight to the
   display. It also accepts verse ranges, e.g. `John 4:5-6`, which displays
   both verses together (capped at 30 verses per range).
7. Pick a background from the swatch bar under the header — solid/gradient
   presets, motion (video) backgrounds from your library folder, or click
   **Upload Image/Video** to add your own — it updates the projector
   immediately and persists if the display page reloads.
8. For announcements, welcome messages, or anything that isn't a Bible
   verse, use the **Custom Text** box (multi-line supported) and click
   **Project** — it displays over whatever background is currently active,
   with no verse-reference line. `Cmd/Ctrl+Enter` also submits. Select some
   text and use the **B / I / U** buttons to bold, italicize, or underline
   it, and the size dropdown to make the whole block Small/Normal/Large/XL.

## Configuration

- `DEEPGRAM_API_KEY` — **required**, in `.env`. Speech recognition is
  disabled without it (manual entry still works).
- `PORT` — server port (default `3000`)
- `TRANSLATION` — Bolls translation code to look up verses in (default
  `KJV`). Any public-domain translation works out of the box; copyrighted
  ones (NIV, ESV, etc.) may have separate licensing/display terms — check
  before using them in a public service.
- `DEEPGRAM_MODEL` — Deepgram model (default `nova-3`)
- `DEEPGRAM_LANGUAGE` — Deepgram language code (default `en`)
- `MOTION_BACKGROUNDS_DIR` — folder scanned for video backgrounds (default
  `/Users/theunitychurch/Documents/STUDIO/images`)

## Current scope / what's next

This MVP handles both **explicit/cue-phrase references** ("John 3:16", "turn
to Romans 8", "verse 1" following earlier context) and **paraphrased
quotes** (a verse recognized from its content, without a citation), via
Bolls' semantic search. Paraphrase matches are labeled `semantic · NN%
match` in the operator UI so it's clear they're a lower-confidence guess —
same one-click approve/reject as everything else.

Known limitation: the local confidence score is a blunt word-overlap
heuristic, not true semantic similarity, so it will occasionally miss a
heavily-reworded paraphrase or (rarely) surface an unrelated verse. Tune
`COVERAGE_THRESHOLD` in `lib/paraphraseMatcher.js` if it's too noisy or too
quiet for your service.
