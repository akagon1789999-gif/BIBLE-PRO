# Sofer 2.0

An AI-powered church presentation app. It listens to a pastor's live speech,
detects Bible references as they're spoken, looks the verse up, and lets an
operator approve it with one click before it appears on the projector/TV —
alongside a song library, a media library (backgrounds, motion graphics,
logos, lower thirds), and a service playlist to plan and step through the
whole service from one operator console.

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
- **Offline fallback** ([`lib/offlineWhisper.js`](lib/offlineWhisper.js)):
  if Deepgram can't be reached — connection drops mid-service, fails to
  start, or the internet is just gone — the server automatically switches
  to a local `whisper.cpp` model (via the optional `nodejs-whisper`
  package) and tells the operator's browser to start sending it audio
  instead. It retries every 20s in the background and switches back the
  moment Deepgram reconnects.
  - **Detection is active, not just reactive**: waiting on Deepgram's SDK
    to report a closed/errored connection isn't enough on its own — an
    already-open TCP connection doesn't necessarily notice a dead network
    right away (flipping off Wi-Fi doesn't error an idle socket
    immediately; the OS can take a long time to notice). So on top of
    reacting to Deepgram closing, the server also independently probes
    `api.deepgram.com` every 20s while "online" and forces the switch the
    moment that probe fails — this is what actually catches a real Wi-Fi
    drop promptly instead of possibly sitting there for a long time
    waiting for Deepgram's socket to notice on its own.
  - **One-time setup, while online**: `npm run setup:offline-stt` downloads
    the model and compiles `whisper.cpp` — this can't happen automatically
    later, since it needs internet the model won't have once it's actually
    needed. Needs `make`/`gcc`/`clang` (present on macOS via Xcode Command
    Line Tools) and `cmake` — if you don't have Homebrew, `python3 -m pip
    install --user cmake` works fine.
  - **Model**: `base.en` by default (good speed/accuracy balance on CPU;
    ~2s to transcribe a 4s clip on this project's dev machine). Override
    with `WHISPER_MODEL` (e.g. `tiny.en` for a slower CPU, `small.en` for
    better accuracy) — re-run the setup script after changing it.
  - **How audio gets to it**: no `ffmpeg` involved anywhere. The browser
    builds real 16kHz mono WAV files directly via the Web Audio API
    (`AudioContext` + `ScriptProcessorNode`, muted through a silent
    `GainNode` so nothing is ever played back through the room's speakers)
    and sends ~5-second segments to the server, which feeds them straight
    into whisper.cpp and then through the *exact same* reference-detection
    pipeline Deepgram's output uses — Auto/Manual mode, sermon logging, all
    of it, unchanged. That `AudioContext` is explicitly `.resume()`d after
    creation — Chrome can create one in a suspended state when it's
    instantiated outside a direct click handler (ours is created later,
    asynchronously, once the server reports a problem), and a suspended
    context silently never produces audio: no errors anywhere, it just
    quietly does nothing, which was the cause of an early bug here where
    offline mode never actually transcribed anything.
  - **Honest limitations**: this is a fallback, not a Deepgram replacement.
    Each ~5s segment is transcribed independently (no cross-chunk context,
    so sentences can get cut awkwardly at boundaries), there are no interim
    results while offline, and there's a few-second gap during the online↔
    offline handover — not an instant, zero-gap hot-swap.
  - **⚠️ This cannot ever work through the Railway URL — by fundamental
    design, not as a bug to fix.** If you're accessing the operator
    console from a Railway link, the page itself, the WebSocket, all of
    it, live on a remote server — if *your* internet drops, your browser
    can't reach that remote server at all anymore, so there's nothing
    running "locally" for it to fall back to. Offline fallback only means
    anything when `server.js` is running **on the same machine as the
    browser** (`npm start`, opened at `localhost:3000`) — only then does
    the browser↔server connection stay alive over the local loopback
    interface while just the server's own outbound connection to Deepgram
    fails. For an actual Sunday service where this matters, run locally
    on the booth laptop, not the Railway URL.
  - **Deployment**: `nodejs-whisper` is an *optional* dependency
    specifically so a build environment without `cmake` (Railway's, for
    example) doesn't fail the whole `npm install` — it just runs without
    offline fallback there, consistent with the point above.
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
  disk. Uploaded backgrounds/motion graphics are recorded in the SQLite
  catalog (see Media Library below), so they survive a page refresh or
  server restart — they used to only exist for the current browser session.
- **Media Library**: [`lib/mediaLibrary.js`](lib/mediaLibrary.js) — a
  SQLite-backed asset catalog (`media_assets` table) with a panel in the
  operator console for browsing, searching, uploading, and deleting assets
  across four categories: Backgrounds, Motion Graphics, Logos, and Lower
  Thirds. Backgrounds and Motion Graphics tiles are click-to-project (same
  flow as the swatch bar); Logos and Lower Thirds are catalog/manage only
  for now — projecting them onto the display is a later phase. Deleting an
  asset removes both its database row and its file in `public/uploads/`;
  folder-scanned motion videos (from `MOTION_BACKGROUNDS_DIR`) appear
  alongside uploads but aren't deletable from here since this app doesn't
  own that folder.
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
  service worker that, combined with a manifest, makes Chrome treat this as
  an installable app. It's network-first for the app shell (always fetches
  the latest `operator.js`/`display.html`/etc. when online, only falling
  back to its cache if the network request actually fails) — a cache-first
  strategy here previously caused real confusion during development, where
  edits silently didn't show up until the cache was manually cleared.
  API calls, uploads, and motion backgrounds are never cached at all.
  Operator and Display each get their **own** manifest
  (`manifest-operator.json` / `manifest-display.json`) with their own
  start page, since they're typically installed on different machines —
  the operator console gets a visible **📲 Install App** button in the
  header once Chrome decides the page qualifies; the display page relies
  on Chrome's own address-bar install icon instead, since nothing should
  ever appear as UI chrome on what's actually being projected. Icons live
  in `public/icons/`.
- **Bible Browser**: a panel for drilling down Old/New Testament → book →
  chapter → verse list, for when you want to browse rather than type a
  reference. Each verse has a **Project** button that sends the exact same
  `manual` WebSocket message the Manual Entry box already used — no new
  live-projection logic, it's just another way to trigger the existing one.
  Backed by two new REST routes, `GET /api/bible/books` and
  `GET /api/bible/chapter/:bookId/:chapter`, both read-only and stateless.
- **Song Library** ([`lib/songLibrary.js`](lib/songLibrary.js)): a SQLite-backed
  catalog of songs (`songs` + `song_sections` tables), each broken into
  labeled sections (Verse 1, Chorus, Bridge, ...). The **Song Library** panel
  lets you search songs, add one (title/artist plus any number of
  label+lyrics sections), and drill into a song to project a section —
  **Prev**/**Next** step through sections in order while the same section
  stays projected, so you don't have to click back into the list between
  verses. Like Bible verses, the operator only ever sends a
  `{songId, sectionIndex}` reference over the `song-section` WebSocket
  message — the server resolves the actual lyrics from the database, so
  there's no way for stale or tampered text to end up on screen. Deleting a
  song cascades to its sections.
- **Service Playlist** ([`lib/playlist.js`](lib/playlist.js)): an ordered,
  SQLite-backed list of service items — scripture, song sections, custom
  text, and backgrounds — built ahead of time and stepped through live. Add
  an item from wherever you'd already find it (a **+** button next to Bible
  verses, song sections, the Custom Text box, and Media Library
  background/motion tiles), reorder with the ▲/▼ buttons, and click any item
  — in the list or in the **Now / Next / After Next** strip at the top of
  the panel — to project it immediately. Playing an item sends only
  `{type: "playlist-play", id}` over the WebSocket; the server resolves and
  projects it through the *exact same* functions the direct verse/song/
  custom-text/background messages already use (`projectScripture`,
  `projectSong`, `projectCustomText`, `projectBackground` in
  [`server.js`](server.js)) — the one bit of refactoring this phase did, so
  a playlist item can never show anything those paths wouldn't otherwise
  allow, and can't go stale (a song or verse plays with whatever's
  currently in the database, not a frozen copy from when it was added).
  There's one live working playlist at a time, but you can snapshot it
  under a name with **Save As…** and reload it later from the dropdown
  above the list — loading **replaces** whatever's currently live, so
  build recurring service structures ("Sunday AM", "Wednesday PM") once
  and reload them each week rather than rebuilding from scratch.
- **OBS overlay** (`public/obs.html`): a transparent-by-default page for
  streaming — add it as an OBS **Browser Source** (`http://localhost:3000/obs.html`
  if OBS runs on the same machine) and it composites verse/custom-text
  directly over your camera feed, no black box behind it. It's wired to
  the exact same broadcasts the projector display uses — approve a verse
  or project custom text as usual and both update together — and uses a
  stronger text outline than the projector display, since legibility over
  live video needs more contrast than over a still image/color. Background
  selection is ignored here by default (there's no "background" needed —
  your camera feed *is* the background) unless you turn on **Show
  background in OBS** in the OBS Control panel, which paints the current
  Sofer background behind the text here too — useful for a dedicated
  "Scripture" scene with no camera in it at all.
- **OBS remote control** ([`lib/obsClient.js`](lib/obsClient.js)): connects
  to OBS's built-in WebSocket server (OBS 28+, no plugin needed) to (1)
  start/stop OBS recording automatically alongside **Start/Stop Listening**,
  and (2) let you switch OBS scenes from an **OBS Control** panel (below
  Bible Browser) — it lists your real scene names from OBS itself and
  highlights the current one. Like offline STT fallback, this only makes
  sense when OBS runs on the same machine/network as this server, and every
  call is defensive: if OBS isn't running or isn't configured, nothing here
  ever interrupts speech recognition or verse projection — it just quietly
  shows "Disconnected" and the recording/scene calls silently no-op.
  **Setup**, once per machine: in OBS, go to **Tools → WebSocket Server
  Settings**, check **Enable WebSocket server**, and either note the port
  (default `4455`) and password, or uncheck **Enable Authentication** for a
  simpler local setup. Then set in `.env`:
  ```
  OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
  OBS_WEBSOCKET_PASSWORD=your-obs-websocket-password
  ```
  (Omit `OBS_WEBSOCKET_PASSWORD` entirely if you disabled authentication.)
  Restart the server after changing either — the OBS Control panel updates
  itself automatically once connected, no other setup needed.

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

Optional, but recommended if this will run on a laptop where the internet
might drop mid-service — do this once, while online:

```bash
npm run setup:offline-stt
```

Then open, on the same laptop:

- **Operator console**: http://localhost:3000/operator.html
- **Display output**: http://localhost:3000/display.html — drag this window
  onto the projector/TV's screen and make it fullscreen (F11 in Chrome).

## Desktop app (Electron)

For a non-technical volunteer setting this up on a booth PC, there's a
double-click installer ([`electron/`](electron/)) that bundles Node.js
itself, opens as a normal desktop app, and replaces hand-editing `.env`
with an actual **Settings** screen — no terminal, no Node.js install, no
Chrome tab to remember to open.

**Building it** (for maintainers — requires the regular [Setup](#setup)
above plus `npm install` to have pulled in `electron`/`electron-builder`):

```bash
npm run dist:mac    # produces dist/Sofer 2.0-<version>.dmg
npm run dist:win    # produces dist/Sofer 2.0 Setup <version>.exe
```

App icons are generated from `public/icons/icon-512.png` into
`build/icon.icns` / `build/icon.ico` — regenerate those first if the logo
changes. The installer intentionally does **not** include the offline
speech-recognition fallback (whisper.cpp) — it's an optional dependency
that needs a native build toolchain per platform; the packaged app still
degrades to it gracefully being simply unavailable, same as on Railway
today. Live (Deepgram) transcription is unaffected.

**Installing it** — these builds are not code-signed (that costs
money/year and isn't worth it for an internal tool yet), so the OS will
warn on first launch:

- **Windows**: run the `.exe`, click **More info** → **Run anyway** on the
  "Windows protected your PC" SmartScreen prompt, then follow the install
  wizard.
- **Mac**: drag the app from the mounted `.dmg` into Applications, then
  **right-click → Open** the first time (regular double-click gets
  silently blocked by Gatekeeper for an unsigned app) and confirm **Open**
  on the dialog.

**First launch** opens a **Settings** screen instead of the main console —
a Deepgram API key is required, OBS WebSocket URL/password and a Motion
Backgrounds folder are optional (under "Advanced"). Saving restarts the
app and applies them. Settings are stored in the OS's normal per-user app
data location (not a `.env` file), and the SQLite database lives there
too, not inside the installed app itself.

The app's **Display** menu replaces the manual "drag the Display window to
the second monitor and press F11" step: **Show on Projector** lists any
secondary monitor and opens the projector output there, fullscreen, in one
click.

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
   click needed. If the internet drops, a **📡 Offline mode** badge appears
   next to the header within about 20 seconds and everything keeps working
   via the local speech engine (see Offline fallback above) — no action
   needed from you.
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

- `DEEPGRAM_API_KEY` — in `.env`. Without it, live speech recognition only
  works if offline fallback is set up (`npm run setup:offline-stt`);
  otherwise manual entry and Custom Text still work regardless.
- `PORT` — server port (default `3000`)
- `TRANSLATION` — Bolls translation code to look up verses in (default
  `KJV`). Any public-domain translation works out of the box; copyrighted
  ones (NIV, ESV, etc.) may have separate licensing/display terms — check
  before using them in a public service.
- `DEEPGRAM_MODEL` — Deepgram model (default `nova-3`)
- `DEEPGRAM_LANGUAGE` — Deepgram language code (default `en`)
- `WHISPER_MODEL` — offline fallback model (default `base.en`) — see
  Offline fallback above. Re-run `npm run setup:offline-stt` after changing.
- `MOTION_BACKGROUNDS_DIR` — folder scanned for video backgrounds (default
  `/Users/theunitychurch/Documents/STUDIO/images`)
- `OBS_WEBSOCKET_URL` — OBS's WebSocket server address (default
  `ws://127.0.0.1:4455`) — see OBS remote control above.
- `OBS_WEBSOCKET_PASSWORD` — OBS's WebSocket password, if authentication is
  enabled (omit entirely if you disabled it in OBS's settings).
- `DB_PATH` — SQLite database file path (default `data/app.db`). **On
  Railway, this file will not survive a redeploy unless a Volume is
  attached and `DB_PATH` points inside its mount path.**

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
