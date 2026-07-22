(() => {
  const statusDot = document.getElementById("statusDot");
  const listenBtn = document.getElementById("listenBtn");
  const clearBtn = document.getElementById("clearBtn");
  const transcriptEl = document.getElementById("transcript");
  const suggestionsEl = document.getElementById("suggestions");
  const previewFrame = document.getElementById("preview-frame");
  const previewBgVideo = document.getElementById("preview-bg-video");
  const previewStage = document.getElementById("preview-stage");
  const previewText = document.getElementById("previewText");
  const previewRef = document.getElementById("previewRef");
  const liveTranslationSelect = document.getElementById("liveTranslationSelect");
  const manualInput = document.getElementById("manualInput");
  const manualBtn = document.getElementById("manualBtn");
  const customTextInput = document.getElementById("customTextInput");
  const customTextBtn = document.getElementById("customTextBtn");
  const customTextAddBtn = document.getElementById("customTextAddBtn");
  const fmtBold = document.getElementById("fmtBold");
  const fmtItalic = document.getElementById("fmtItalic");
  const fmtUnderline = document.getElementById("fmtUnderline");
  const fmtSize = document.getElementById("fmtSize");
  const bgSwatchesEl = document.getElementById("bg-swatches");
  const bgUploadBtn = document.getElementById("bgUploadBtn");
  const bgFileInput = document.getElementById("bgFileInput");
  const downloadRecordingLink = document.getElementById("downloadRecordingLink");
  const speakBtn = document.getElementById("speakBtn");
  const modeManualBtn = document.getElementById("modeManualBtn");
  const modeAutoBtn = document.getElementById("modeAutoBtn");
  const installBtn = document.getElementById("installBtn");
  const sttModeLabel = document.getElementById("sttModeLabel");
  const bibleTranslationSelect = document.getElementById("bibleTranslationSelect");
  const bibleBackBtn = document.getElementById("bibleBackBtn");
  const bibleBreadcrumbLabel = document.getElementById("bibleBreadcrumbLabel");
  const bibleBrowserBody = document.getElementById("bibleBrowserBody");
  const obsStatusBadge = document.getElementById("obsStatusBadge");
  const obsScenesList = document.getElementById("obsScenesList");
  const obsBgToggleBtn = document.getElementById("obsBgToggleBtn");
  const mediaTabs = document.getElementById("mediaTabs");
  const mediaSearchInput = document.getElementById("mediaSearchInput");
  const mediaUploadBtn = document.getElementById("mediaUploadBtn");
  const mediaFileInput = document.getElementById("mediaFileInput");
  const mediaGrid = document.getElementById("mediaGrid");
  const songAddBtn = document.getElementById("songAddBtn");
  const songSearchInput = document.getElementById("songSearchInput");
  const songBody = document.getElementById("songBody");
  const playlistStrip = document.getElementById("playlistStrip");
  const playlistList = document.getElementById("playlistList");
  const playlistSaveAsBtn = document.getElementById("playlistSaveAsBtn");
  const savedPlaylistSelect = document.getElementById("savedPlaylistSelect");
  const savedPlaylistDeleteBtn = document.getElementById("savedPlaylistDeleteBtn");

  let ws = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let listening = false;
  let micLevelAudioContext = null;
  let micLevelAnalyser = null;
  let micLevelRAF = null;
  let finalTranscriptLog = [];
  let availableTranslations = [];
  let popularTranslationCodes = [];
  let recordedChunks = []; // audio Blobs from every Start Listening session, for local download only
  let currentMode = "manual"; // re-sent to the server on every (re)connect — see set-mode below

  // Offline speech fallback: a second, independent capture path (Web Audio
  // API, not MediaRecorder) that only spins up when the server says Deepgram
  // is unreachable. Builds real 16kHz mono WAV files in pure JS — no ffmpeg,
  // no server-side conversion needed.
  const OFFLINE_SAMPLE_RATE = 16000;
  const OFFLINE_SEGMENT_MS = 5000;
  let offlineAudioContext = null;
  let offlineProcessor = null;
  let offlineSourceNode = null;
  let offlineSilentGain = null;
  let offlineChunks = [];
  let offlineFlushTimer = null;

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?role=operator`);
    ws.onopen = () => wsSend({ type: "set-mode", mode: currentMode });
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "suggestion") addSuggestionCard(msg.suggestion);
      if (msg.type === "final") {
        finalTranscriptLog.push(msg.text);
        renderTranscript("");
      }
      if (msg.type === "interim") renderTranscript(msg.text);
      if (msg.type === "show") showPreview(msg);
      if (msg.type === "clear") hidePreview();
      if (msg.type === "background") applyPreviewBackground(msg.background);
      if (msg.type === "playlist-position") applyPlaylistPosition(msg.currentId);
      if (msg.type === "obs-background-toggle") applyObsBackgroundToggle(msg.enabled);
      if (msg.type === "stt-mode") applySttMode(msg.mode);
      if (msg.type === "error") {
        console.error(msg.message);
        alert(msg.message);
      }
    };
    ws.onclose = () => setTimeout(connectWs, 1500);
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function renderTranscript(interimText) {
    const finals = finalTranscriptLog
      .slice(-8)
      .map((t) => `<span class="final">${escapeHtml(t)}</span>`)
      .join(" ");
    const interim = interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : "";
    transcriptEl.innerHTML = finals + " " + interim;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function translationOptionsHtml(selected) {
    if (!availableTranslations.length) {
      return `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>`;
    }
    const optionHtml = (t) =>
      `<option value="${escapeHtml(t.code)}"${t.code === selected ? " selected" : ""}>${escapeHtml(t.code)} — ${escapeHtml(t.name)}</option>`;
    const byCode = new Map(availableTranslations.map((t) => [t.code, t]));
    const popular = popularTranslationCodes.map((c) => byCode.get(c)).filter(Boolean);
    const more = availableTranslations.filter((t) => !popularTranslationCodes.includes(t.code));
    return `${popular.map(optionHtml).join("")}<optgroup label="More">${more.map(optionHtml).join("")}</optgroup>`;
  }

  function addSuggestionCard(s) {
    const existing = suggestionsEl.querySelector(`.card[data-suggestion-id="${s.id}"]`);
    if (existing) {
      updateSuggestionCard(existing, s);
      return;
    }

    const empty = suggestionsEl.querySelector(".empty");
    if (empty) empty.remove();

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.suggestionId = s.id;
    const label = s.isChapterOnly ? `${s.bookName} ${s.chapter}` : `${s.bookName} ${s.chapter}:${s.verse}`;
    card.innerHTML = `
      <h3>${label}<span class="badge">${s.source === "semantic" ? `semantic · ${s.score}% match` : s.source}</span></h3>
      <select class="translation-select">${translationOptionsHtml(s.translation)}</select>
      <p>${s.text ? escapeHtml(s.text) : "<em>Verse text unavailable</em>"}</p>
      <div class="actions">
        <button class="btn-primary approve">Approve ▸ Display</button>
        <button class="btn-neutral reject">Reject</button>
      </div>
    `;
    card.querySelector(".translation-select").onchange = (e) => {
      card.querySelector("p").classList.add("loading");
      wsSend({ type: "switch-translation", id: s.id, translation: e.target.value });
    };
    card.querySelector(".approve").onclick = () => {
      wsSend({ type: "approve", id: s.id });
      card.remove();
      if (!suggestionsEl.children.length) {
        suggestionsEl.innerHTML = '<div class="empty">No suggestions yet.</div>';
      }
    };
    card.querySelector(".reject").onclick = () => {
      wsSend({ type: "reject", id: s.id });
      card.remove();
      if (!suggestionsEl.children.length) {
        suggestionsEl.innerHTML = '<div class="empty">No suggestions yet.</div>';
      }
    };
    suggestionsEl.prepend(card);
  }

  function updateSuggestionCard(card, s) {
    const p = card.querySelector("p");
    p.classList.remove("loading");
    p.innerHTML = s.text ? escapeHtml(s.text) : "<em>Verse text unavailable</em>";
    const select = card.querySelector(".translation-select");
    if (select && select.value !== s.translation) select.value = s.translation;
  }

  async function loadTranslations() {
    try {
      const res = await fetch("/api/translations");
      const data = await res.json();
      availableTranslations = data.translations || [];
      popularTranslationCodes = data.popular || [];
      liveTranslationSelect.innerHTML = translationOptionsHtml("KJV");
      bibleTranslationSelect.innerHTML = translationOptionsHtml("KJV");
    } catch (err) {
      console.error("Failed to load translations:", err);
    }
  }

  liveTranslationSelect.onchange = (e) => {
    wsSend({ type: "switch-live-translation", translation: e.target.value });
  };

  const RECORDER_MIME = "audio/webm;codecs=opus";
  const CHUNK_MS = 250;

  // Reads the mic's actual live input level (via an AnalyserNode on the
  // same stream MediaRecorder is already using — Web Audio API supports
  // multiple consumers of one MediaStream) and drives the status dot's
  // --mic-level CSS variable each frame, so the dot visibly pulses with
  // real sound as proof the mic is actually capturing audio.
  function startMicLevelMeter(stream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    micLevelAudioContext = new AudioContextCtor();
    const source = micLevelAudioContext.createMediaStreamSource(stream);
    micLevelAnalyser = micLevelAudioContext.createAnalyser();
    micLevelAnalyser.fftSize = 256;
    micLevelAnalyser.smoothingTimeConstant = 0.6;
    source.connect(micLevelAnalyser);

    const data = new Uint8Array(micLevelAnalyser.frequencyBinCount);
    const tick = () => {
      micLevelAnalyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(1, sum / data.length / 90); // 90 tuned for normal speaking volume
      statusDot.style.setProperty("--mic-level", level.toFixed(3));
      micLevelRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopMicLevelMeter() {
    if (micLevelRAF) cancelAnimationFrame(micLevelRAF);
    micLevelRAF = null;
    micLevelAnalyser = null;
    if (micLevelAudioContext) {
      micLevelAudioContext.close().catch(() => {});
      micLevelAudioContext = null;
    }
    statusDot.style.removeProperty("--mic-level");
  }

  async function startListening() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert("This browser doesn't support microphone capture. Please use Google Chrome.");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert(
        err.name === "NotFoundError" || err.name === "DevicesNotFoundError"
          ? "No microphone was found. Check that one is connected and try again."
          : "Microphone access was denied. Allow microphone access for this page in Chrome's settings, then click Start Listening again."
      );
      return;
    }

    wsSend({ type: "start-audio" });

    const options = MediaRecorder.isTypeSupported(RECORDER_MIME) ? { mimeType: RECORDER_MIME } : undefined;
    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      recordedChunks.push(e.data); // kept locally only, for the Download Audio link — never sent anywhere
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    mediaRecorder.onerror = (e) => console.error("MediaRecorder error:", e.error);
    mediaRecorder.start(CHUNK_MS);
    startMicLevelMeter(mediaStream);

    listening = true;
    statusDot.classList.add("live");
    listenBtn.textContent = "Stop Listening";
  }

  function stopListening() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    mediaStream = null;
    stopMicLevelMeter();
    wsSend({ type: "stop-audio" });
    stopOfflineCapture();
    sttModeLabel.style.display = "none";

    listening = false;
    statusDot.classList.remove("live");
    listenBtn.textContent = "Start Listening";
  }

  listenBtn.onclick = () => {
    if (!listening) startListening();
    else stopListening();
  };

  clearBtn.onclick = () => wsSend({ type: "clear" });

  function applySttMode(mode) {
    if (mode === "offline") {
      sttModeLabel.textContent = "📡 Offline mode — local speech engine";
      sttModeLabel.classList.add("offline");
      startOfflineCapture();
    } else {
      sttModeLabel.textContent = "🌐 Online — Deepgram";
      sttModeLabel.classList.remove("offline");
      stopOfflineCapture();
    }
    sttModeLabel.style.display = "inline-block";
  }

  function startOfflineCapture() {
    if (offlineAudioContext || !mediaStream) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    offlineAudioContext = new AudioContextCtor({ sampleRate: OFFLINE_SAMPLE_RATE });
    offlineSourceNode = offlineAudioContext.createMediaStreamSource(mediaStream);
    offlineProcessor = offlineAudioContext.createScriptProcessor(4096, 1, 1);
    offlineChunks = [];
    offlineProcessor.onaudioprocess = (e) => {
      offlineChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    // ScriptProcessorNode only fires once connected through to the destination.
    // Route through a silent gain so the mic is never actually played back
    // (would otherwise risk feedback through the sanctuary's speakers).
    offlineSilentGain = offlineAudioContext.createGain();
    offlineSilentGain.gain.value = 0;
    offlineSourceNode.connect(offlineProcessor);
    offlineProcessor.connect(offlineSilentGain);
    offlineSilentGain.connect(offlineAudioContext.destination);

    // Chrome can create an AudioContext in "suspended" state when it's not
    // instantiated directly inside a click handler (ours is created later,
    // async, after a server message) — without resume() it silently never
    // produces audio: no errors anywhere, onaudioprocess just never fires.
    if (offlineAudioContext.state === "suspended") {
      offlineAudioContext.resume().catch((err) => console.error("Failed to resume offline AudioContext:", err));
    }

    offlineFlushTimer = setInterval(flushOfflineSegment, OFFLINE_SEGMENT_MS);
  }

  function stopOfflineCapture() {
    if (offlineFlushTimer) {
      clearInterval(offlineFlushTimer);
      offlineFlushTimer = null;
    }
    if (offlineProcessor) {
      offlineProcessor.disconnect();
      offlineProcessor.onaudioprocess = null;
      offlineProcessor = null;
    }
    if (offlineSourceNode) {
      offlineSourceNode.disconnect();
      offlineSourceNode = null;
    }
    if (offlineSilentGain) {
      offlineSilentGain.disconnect();
      offlineSilentGain = null;
    }
    if (offlineAudioContext) {
      offlineAudioContext.close().catch(() => {});
      offlineAudioContext = null;
    }
    offlineChunks = [];
  }

  async function flushOfflineSegment() {
    if (!offlineChunks.length) return;
    const samples = mergeFloat32Arrays(offlineChunks);
    offlineChunks = [];
    if (samples.length < OFFLINE_SAMPLE_RATE * 0.5) return; // less than half a second — skip
    const blob = buildWavBlob(samples, OFFLINE_SAMPLE_RATE);
    const audioBase64 = await blobToBase64(blob);
    wsSend({ type: "offline-audio", audioBase64 });
  }

  function mergeFloat32Arrays(chunks) {
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0, offset = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function buildWavBlob(samples, sampleRate) {
    const pcmBuffer = floatTo16BitPCM(samples);
    const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
    const view = new DataView(wavBuffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + pcmBuffer.byteLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, pcmBuffer.byteLength, true);
    new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer));
    return new Blob([wavBuffer], { type: "audio/wav" });
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function setMode(mode) {
    currentMode = mode;
    modeManualBtn.classList.toggle("active", mode === "manual");
    modeAutoBtn.classList.toggle("active", mode === "auto");
    wsSend({ type: "set-mode", mode });
  }
  modeManualBtn.onclick = () => setMode("manual");
  modeAutoBtn.onclick = () => setMode("auto");

  downloadRecordingLink.onclick = (e) => {
    e.preventDefault();
    if (!recordedChunks.length) {
      alert("No audio recorded yet. Click Start Listening first, then come back here when you're done.");
      return;
    }
    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sermon-audio-${new Date().toISOString().slice(0, 10)}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function formatRef(msg) {
    if (msg.song) return `${msg.songTitle} — ${msg.sectionLabel}`;
    if (msg.isChapterOnly) return `${msg.bookName} ${msg.chapter} (${msg.translation})`;
    const verses = msg.verseEnd ? `${msg.verse}-${msg.verseEnd}` : msg.verse;
    return `${msg.bookName} ${msg.chapter}:${verses} (${msg.translation})`;
  }

  function showPreview(msg) {
    if (msg.custom) {
      // Server already sanitized this HTML (lib/richText.js) — safe to render directly.
      previewText.innerHTML = msg.html || "";
      previewText.className = `size-${msg.fontSize || "normal"}`;
      previewRef.textContent = "";
      previewRef.style.display = "none";
      liveTranslationSelect.style.display = "none";
    } else {
      previewText.textContent = msg.text || "";
      previewText.className = "size-normal";
      previewRef.textContent = formatRef(msg);
      previewRef.style.display = "";
      if (msg.song) {
        liveTranslationSelect.style.display = "none";
      } else {
        liveTranslationSelect.style.display = "";
        if (liveTranslationSelect.value !== msg.translation) liveTranslationSelect.value = msg.translation;
      }
    }
    previewStage.classList.add("visible");
  }

  function hidePreview() {
    previewStage.classList.remove("visible");
    liveTranslationSelect.style.display = "none";
  }

  function applyPreviewBackground(background) {
    if (!background) return;
    if (background.type === "video") {
      previewFrame.style.background = "#000000";
      if (previewBgVideo.src !== new URL(background.url, location.href).href) {
        previewBgVideo.src = background.url;
      }
      previewBgVideo.style.display = "block";
      previewBgVideo.play().catch(() => {});
    } else {
      previewBgVideo.pause();
      previewBgVideo.removeAttribute("src");
      previewBgVideo.style.display = "none";
      previewFrame.style.background =
        background.type === "image" ? `center / cover no-repeat url("${background.url}")` : background.css;
    }
    syncSwatchSelection(background);
  }

  function backgroundKey(bg) {
    if (bg.type === "image" || bg.type === "video") return `${bg.type}:${bg.url}`;
    return `preset:${bg.id}`;
  }

  function syncSwatchSelection(background) {
    const key = backgroundKey(background);
    for (const el of bgSwatchesEl.querySelectorAll(".swatch")) {
      el.classList.toggle("selected", el.dataset.bgKey === key);
    }
  }

  manualBtn.onclick = () => submitManual();
  manualInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitManual(); });

  function submitManual() {
    const raw = manualInput.value.trim();
    if (!raw) return;
    // Accepts "Book Chapter:Verse" or a range "Book Chapter:Start-End",
    // e.g. "John 3:16", "1 Corinthians 13:4", or "John 4:5-6"
    const m = raw.match(/^(.+?)\s+(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
    if (!m) {
      alert('Format: "Book Chapter:Verse" or "Book Chapter:Start-End", e.g. "John 3:16" or "John 4:5-6"');
      return;
    }
    wsSend({ type: "manual", bookName: m[1].trim(), chapter: m[2], verse: m[3], verseEnd: m[4] || undefined });
    manualInput.value = "";
  }

  function applyFormat(command) {
    customTextInput.focus();
    document.execCommand(command);
    updateFormatToolbar();
  }

  function updateFormatToolbar() {
    fmtBold.classList.toggle("active", document.queryCommandState("bold"));
    fmtItalic.classList.toggle("active", document.queryCommandState("italic"));
    fmtUnderline.classList.toggle("active", document.queryCommandState("underline"));
  }

  fmtBold.onclick = () => applyFormat("bold");
  fmtItalic.onclick = () => applyFormat("italic");
  fmtUnderline.onclick = () => applyFormat("underline");
  customTextInput.addEventListener("keyup", updateFormatToolbar);
  customTextInput.addEventListener("mouseup", updateFormatToolbar);
  customTextInput.addEventListener("focus", updateFormatToolbar);

  customTextBtn.onclick = () => submitCustomText();
  customTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitCustomText();
  });

  function submitCustomText() {
    const html = customTextInput.innerHTML;
    if (!customTextInput.textContent.trim()) return;
    wsSend({ type: "custom-text", html, fontSize: fmtSize.value });
  }

  customTextAddBtn.onclick = () => {
    const text = customTextInput.textContent.trim();
    if (!text) return;
    const label = text.length > 50 ? `${text.slice(0, 50)}…` : text;
    addToPlaylist("custom_text", label, { html: customTextInput.innerHTML, fontSize: fmtSize.value });
  };

  speakBtn.onclick = () => {
    if (!window.speechSynthesis) {
      alert("This browser doesn't support text-to-speech.");
      return;
    }
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      speakBtn.textContent = "🔊 Speak";
      return;
    }
    const text = customTextInput.textContent.trim();
    if (!text) {
      alert("Type something in the Custom Text box first.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = utterance.onerror = () => {
      speakBtn.textContent = "🔊 Speak";
    };
    speakBtn.textContent = "⏹ Stop";
    speechSynthesis.speak(utterance);
  };

  function renderSwatch(background, label) {
    const btn = document.createElement("button");
    btn.className = "swatch";
    btn.type = "button";
    btn.title = label;
    btn.dataset.bgKey = backgroundKey(background);
    if (background.type === "video") {
      const video = document.createElement("video");
      video.src = background.url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.play().catch(() => {});
      btn.appendChild(video);
    } else {
      btn.style.background =
        background.type === "image" ? `center / cover no-repeat url("${background.url}")` : background.css;
    }
    btn.onclick = () => selectBackground(background);
    return btn;
  }

  // Selection is a request, not a direct UI update — the server echoes the
  // resulting "background" message back to every operator, and that's what
  // actually drives the swatch highlight and preview (see applyPreviewBackground).
  function selectBackground(background) {
    const payload =
      background.type === "image" || background.type === "video"
        ? { type: background.type, url: background.url }
        : { type: "preset", id: background.id };
    wsSend({ type: "set-background", background: payload });
  }

  function addDivider() {
    const div = document.createElement("div");
    div.className = "bg-divider";
    bgSwatchesEl.appendChild(div);
  }

  // Re-run after every background/motion upload or delete (from either the
  // quick bar below or the Media Library panel) so the swatch bar always
  // reflects the persisted catalog, not just whatever this tab appended.
  async function loadBackgroundPresets() {
    try {
      const res = await fetch("/api/backgrounds");
      const data = await res.json();
      bgSwatchesEl.innerHTML = "";
      (data.presets || []).forEach((preset) => {
        const background = { type: "preset", id: preset.id, css: preset.css };
        bgSwatchesEl.appendChild(renderSwatch(background, preset.label));
      });
      if ((data.uploads || []).length) {
        addDivider();
        data.uploads.forEach((upload) => {
          const background = { type: upload.type, url: upload.url };
          bgSwatchesEl.appendChild(renderSwatch(background, upload.label));
        });
      }
      if ((data.motion || []).length) {
        addDivider();
        data.motion.forEach((motion) => {
          const background = { type: "video", url: motion.url };
          bgSwatchesEl.appendChild(renderSwatch(background, `${motion.label} (motion)`));
        });
      }
    } catch (err) {
      console.error("Failed to load background presets:", err);
    }
  }

  bgUploadBtn.onclick = () => bgFileInput.click();
  bgFileInput.onchange = async () => {
    const file = bgFileInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    bgUploadBtn.disabled = true;
    bgUploadBtn.textContent = "Uploading…";
    try {
      const res = await fetch("/api/backgrounds/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await loadBackgroundPresets();
      selectBackground({ type: data.type, url: data.url });
      refreshMediaGridIfShowing(["background", "motion"]);
    } catch (err) {
      alert("Background upload failed: " + err.message);
    } finally {
      bgUploadBtn.disabled = false;
      bgUploadBtn.textContent = "Upload Image/Video";
      bgFileInput.value = "";
    }
  };

  // --- Media Library: catalog of Backgrounds / Motion Graphics / Logos /
  // Lower Thirds, backed by lib/mediaLibrary.js. Backgrounds and Motion
  // Graphics are click-to-project (same selectBackground flow as the quick
  // swatch bar above); Logos and Lower Thirds are catalog/manage only for
  // now — projecting them is a later phase.
  const MEDIA_CATEGORIES = [
    { id: "background", label: "Backgrounds", clickable: true },
    { id: "motion", label: "Motion Graphics", clickable: true },
    { id: "logo", label: "Logos", clickable: false },
    { id: "lower_third", label: "Lower Thirds", clickable: false },
  ];
  let mediaActiveCategory = MEDIA_CATEGORIES[0].id;

  function renderMediaTabs() {
    mediaTabs.innerHTML = "";
    MEDIA_CATEGORIES.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `media-tab${cat.id === mediaActiveCategory ? " active" : ""}`;
      btn.textContent = cat.label;
      btn.onclick = () => {
        mediaActiveCategory = cat.id;
        renderMediaTabs();
        loadMediaAssets();
      };
      mediaTabs.appendChild(btn);
    });
  }

  function activeMediaCategoryConfig() {
    return MEDIA_CATEGORIES.find((c) => c.id === mediaActiveCategory);
  }

  function renderMediaTile(asset, clickable) {
    const tile = document.createElement(clickable ? "button" : "div");
    tile.className = `media-tile${clickable ? " clickable" : ""}`;
    if (clickable) tile.type = "button";
    if (asset.kind === "video") {
      const video = document.createElement("video");
      video.src = asset.url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.play().catch(() => {});
      tile.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = asset.url;
      img.alt = asset.label;
      tile.appendChild(img);
    }
    const label = document.createElement("span");
    label.className = "media-tile-label";
    label.textContent = asset.label;
    tile.appendChild(label);
    if (asset.deletable) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "media-tile-delete";
      del.title = "Delete";
      del.textContent = "×";
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${asset.label}"?`)) return;
        try {
          const res = await fetch(`/api/media/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
          loadMediaAssets();
          if (asset.category === "background" || asset.category === "motion") loadBackgroundPresets();
        } catch (err) {
          alert("Delete failed: " + err.message);
        }
      };
      tile.appendChild(del);
    }
    if (clickable) {
      tile.onclick = () => selectBackground({ type: asset.kind === "video" ? "video" : "image", url: asset.url });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "media-tile-add";
      add.title = "Add to Playlist";
      add.textContent = "+";
      add.onclick = (e) => {
        e.stopPropagation();
        addToPlaylist("background", asset.label, { type: asset.kind === "video" ? "video" : "image", url: asset.url });
      };
      tile.appendChild(add);
    }
    return tile;
  }

  async function loadMediaAssets() {
    const cat = activeMediaCategoryConfig();
    mediaGrid.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const params = mediaSearchInput.value.trim() ? `?search=${encodeURIComponent(mediaSearchInput.value.trim())}` : "";
      const res = await fetch(`/api/media/${cat.id}${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load media.");
      mediaGrid.innerHTML = "";
      if (!data.assets.length) {
        mediaGrid.innerHTML = '<div class="empty">No assets yet.</div>';
        return;
      }
      data.assets.forEach((asset) => mediaGrid.appendChild(renderMediaTile(asset, cat.clickable)));
    } catch (err) {
      mediaGrid.innerHTML = '<div class="empty">Could not load media.</div>';
      console.error("Failed to load media assets:", err);
    }
  }

  function refreshMediaGridIfShowing(categories) {
    if (categories.includes(mediaActiveCategory)) loadMediaAssets();
  }

  let mediaSearchDebounce;
  mediaSearchInput.addEventListener("input", () => {
    clearTimeout(mediaSearchDebounce);
    mediaSearchDebounce = setTimeout(loadMediaAssets, 250);
  });

  mediaUploadBtn.onclick = () => mediaFileInput.click();
  mediaFileInput.onchange = async () => {
    const file = mediaFileInput.files[0];
    if (!file) return;
    const cat = activeMediaCategoryConfig();
    const formData = new FormData();
    formData.append("file", file);
    mediaUploadBtn.disabled = true;
    mediaUploadBtn.textContent = "Uploading…";
    try {
      const res = await fetch(`/api/media/${cat.id}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      loadMediaAssets();
      if (cat.id === "background" || cat.id === "motion") loadBackgroundPresets();
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      mediaUploadBtn.disabled = false;
      mediaUploadBtn.textContent = "Upload";
      mediaFileInput.value = "";
    }
  };

  // --- Song Library: search/browse songs, drill into a song's sections,
  // and project one at a time. Prev/Next just re-sends "song-section" with
  // the next index — the server resolves the actual lyrics from the DB
  // (same "client sends a reference, server resolves content" pattern as
  // Bible verses), so there's no risk of stale/tampered lyrics on screen.
  let selectedSong = null;
  let songActiveSectionIndex = null;

  async function loadSongs() {
    songBody.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const q = songSearchInput.value.trim();
      const res = await fetch(`/api/songs${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      renderSongList(data.songs || []);
    } catch (err) {
      songBody.innerHTML = '<div class="empty">Could not load songs.</div>';
      console.error("Failed to load songs:", err);
    }
  }

  function renderSongList(songs) {
    selectedSong = null;
    songActiveSectionIndex = null;
    if (!songs.length) {
      songBody.innerHTML = '<div class="empty">No songs yet — add one to get started.</div>';
      return;
    }
    songBody.innerHTML = "";
    songs.forEach((song) => {
      const item = document.createElement("div");
      item.className = "song-list-item";
      const meta = `${song.artist ? escapeHtml(song.artist) + " · " : ""}${song.sectionCount} section${song.sectionCount === 1 ? "" : "s"}`;
      item.innerHTML = `<span class="song-title">${escapeHtml(song.title)}</span><span class="song-meta">${meta}</span>`;
      item.onclick = () => openSongDetail(song.id);
      songBody.appendChild(item);
    });
  }

  async function openSongDetail(id) {
    songBody.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const res = await fetch(`/api/songs/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Song not found.");
      selectedSong = data.song;
      songActiveSectionIndex = null;
      renderSongDetail();
    } catch (err) {
      songBody.innerHTML = '<div class="empty">Could not load song.</div>';
      console.error("Failed to load song:", err);
    }
  }

  function songBackButton(label, onClick) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn-neutral bible-back";
    back.style.marginBottom = "10px";
    back.textContent = label;
    back.onclick = onClick;
    return back;
  }

  function projectSongSection(index) {
    if (!selectedSong || index < 0 || index >= selectedSong.sections.length) return;
    songActiveSectionIndex = index;
    wsSend({ type: "song-section", songId: selectedSong.id, sectionIndex: index });
    renderSongDetail();
  }

  function renderSongDetail() {
    songBody.innerHTML = "";
    songBody.appendChild(songBackButton("‹ Back to Songs", () => loadSongs()));

    const header = document.createElement("div");
    header.innerHTML =
      `<div class="song-detail-title">${escapeHtml(selectedSong.title)}</div>` +
      (selectedSong.artist ? `<div class="song-detail-artist">${escapeHtml(selectedSong.artist)}</div>` : "");
    songBody.appendChild(header);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-danger";
    deleteBtn.style.cssText = "font-size:12px;padding:5px 10px;margin-bottom:10px;";
    deleteBtn.textContent = "Delete Song";
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${selectedSong.title}"?`)) return;
      try {
        const res = await fetch(`/api/songs/${selectedSong.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
        loadSongs();
      } catch (err) {
        alert("Delete failed: " + err.message);
      }
    };
    songBody.appendChild(deleteBtn);

    selectedSong.sections.forEach((section, i) => {
      const item = document.createElement("div");
      item.className = `song-section-item${songActiveSectionIndex === i ? " live" : ""}`;
      const snippet = (section.content.split("\n")[0] || "").slice(0, 60);
      item.innerHTML = `
        <button type="button" class="song-section-project">
          <div class="song-section-label">${escapeHtml(section.label)}</div>
          <div class="song-section-snippet">${escapeHtml(snippet)}</div>
        </button>
        <button type="button" class="song-section-add" title="Add to Playlist">+</button>
      `;
      item.querySelector(".song-section-project").onclick = () => projectSongSection(i);
      item.querySelector(".song-section-add").onclick = () => {
        addToPlaylist("song", `${selectedSong.title} — ${section.label}`, { songId: selectedSong.id, sectionIndex: i });
      };
      songBody.appendChild(item);
    });

    const nav = document.createElement("div");
    nav.className = "song-nav";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "btn-neutral";
    prevBtn.textContent = "‹ Prev";
    prevBtn.disabled = songActiveSectionIndex === null || songActiveSectionIndex <= 0;
    prevBtn.onclick = () => projectSongSection(songActiveSectionIndex - 1);
    const pos = document.createElement("span");
    pos.className = "song-nav-pos";
    pos.textContent =
      songActiveSectionIndex === null
        ? `${selectedSong.sections.length} section${selectedSong.sections.length === 1 ? "" : "s"}`
        : `${songActiveSectionIndex + 1} / ${selectedSong.sections.length}`;
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "btn-neutral";
    nextBtn.textContent = "Next ›";
    nextBtn.disabled = songActiveSectionIndex !== null && songActiveSectionIndex >= selectedSong.sections.length - 1;
    nextBtn.onclick = () => projectSongSection(songActiveSectionIndex === null ? 0 : songActiveSectionIndex + 1);
    nav.appendChild(prevBtn);
    nav.appendChild(pos);
    nav.appendChild(nextBtn);
    songBody.appendChild(nav);
  }

  function renderSongAddForm() {
    songBody.innerHTML = "";
    songBody.appendChild(songBackButton("‹ Cancel", () => loadSongs()));

    const form = document.createElement("div");
    form.className = "song-form";
    form.innerHTML = `
      <input type="text" id="songFormTitle" placeholder="Song title" />
      <input type="text" id="songFormArtist" placeholder="Artist (optional)" />
      <div id="songFormSections"></div>
      <div class="song-form-actions">
        <button type="button" class="btn-neutral" id="songFormAddSection">+ Add Section</button>
        <button type="button" class="btn-primary" id="songFormSave">Save Song</button>
      </div>
    `;
    songBody.appendChild(form);

    const sectionsEl = form.querySelector("#songFormSections");
    function addSectionRow(label) {
      const row = document.createElement("div");
      row.className = "song-section-row";
      row.innerHTML = `
        <button type="button" class="song-section-row-remove" title="Remove section">×</button>
        <input type="text" class="song-form-label" placeholder="Label (e.g. Verse 1, Chorus)" value="${escapeHtml(label || "")}" />
        <textarea class="song-form-content" placeholder="Lyrics…"></textarea>
      `;
      row.querySelector(".song-section-row-remove").onclick = () => row.remove();
      sectionsEl.appendChild(row);
    }
    addSectionRow("Verse 1");
    form.querySelector("#songFormAddSection").onclick = () => addSectionRow("");

    form.querySelector("#songFormSave").onclick = async () => {
      const title = form.querySelector("#songFormTitle").value.trim();
      const artist = form.querySelector("#songFormArtist").value.trim();
      const sections = [...sectionsEl.querySelectorAll(".song-section-row")].map((row) => ({
        label: row.querySelector(".song-form-label").value.trim(),
        content: row.querySelector(".song-form-content").value.trim(),
      }));
      if (!title) return alert("Song title is required.");
      if (!sections.some((s) => s.label && s.content)) return alert("At least one section needs both a label and lyrics.");
      try {
        const res = await fetch("/api/songs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, artist, sections }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save song.");
        loadSongs();
      } catch (err) {
        alert("Save failed: " + err.message);
      }
    };
  }

  songAddBtn.onclick = () => {
    renderSongAddForm();
  };

  let songSearchDebounce;
  songSearchInput.addEventListener("input", () => {
    clearTimeout(songSearchDebounce);
    songSearchDebounce = setTimeout(loadSongs, 250);
  });

  // --- Service Playlist: an ordered list of items (scripture/song/custom
  // text/background) built ahead of time via the "+" buttons scattered
  // through the other panels. Playing an item sends only {type:
  // "playlist-play", id} — the server resolves and re-dispatches through
  // the exact same projection functions the direct WS messages already
  // use (see playPlaylistItem in server.js), so a playlist item can never
  // show anything those functions wouldn't otherwise allow.
  const PLAYLIST_TYPE_LABELS = { scripture: "Scripture", song: "Song", custom_text: "Custom Text", background: "Background" };
  let playlistItems = [];
  let currentPlaylistId = null;

  async function addToPlaylist(type, label, payload) {
    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, label, payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add to playlist.");
      await loadPlaylist();
    } catch (err) {
      alert("Could not add to playlist: " + err.message);
    }
  }

  async function loadPlaylist() {
    try {
      const res = await fetch("/api/playlist");
      const data = await res.json();
      playlistItems = data.items || [];
      renderPlaylistStrip();
      renderPlaylistList();
    } catch (err) {
      playlistList.innerHTML = '<div class="empty">Could not load playlist.</div>';
      console.error("Failed to load playlist:", err);
    }
  }

  function applyPlaylistPosition(currentId) {
    currentPlaylistId = currentId;
    renderPlaylistStrip();
    renderPlaylistList();
  }

  function playPlaylistItemById(id) {
    wsSend({ type: "playlist-play", id });
  }

  function renderPlaylistStrip() {
    const currentIdx = playlistItems.findIndex((i) => i.id === currentPlaylistId);
    const rows = [
      { tag: "Now", item: currentIdx >= 0 ? playlistItems[currentIdx] : null },
      { tag: "Next", item: currentIdx >= 0 ? playlistItems[currentIdx + 1] : playlistItems[0] },
      { tag: "After Next", item: currentIdx >= 0 ? playlistItems[currentIdx + 2] : playlistItems[1] },
    ];
    playlistStrip.innerHTML = "";
    rows.forEach(({ tag, item }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `playlist-strip-row${item && item.id === currentPlaylistId ? " current" : ""}`;
      row.disabled = !item;
      row.innerHTML =
        `<span class="playlist-strip-tag">${tag}</span>` +
        `<span class="playlist-strip-label">${item ? escapeHtml(item.label) : "—"}</span>`;
      if (item) row.onclick = () => playPlaylistItemById(item.id);
      playlistStrip.appendChild(row);
    });
  }

  function renderPlaylistList() {
    if (!playlistItems.length) {
      playlistList.innerHTML =
        '<div class="empty">Playlist is empty — use the + buttons throughout the console to add items.</div>';
      return;
    }
    playlistList.innerHTML = "";
    playlistItems.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = `playlist-item${item.id === currentPlaylistId ? " current" : ""}`;
      row.innerHTML = `
        <button type="button" class="playlist-item-main">
          <div class="playlist-item-type">${PLAYLIST_TYPE_LABELS[item.type] || item.type}</div>
          <div class="playlist-item-label">${escapeHtml(item.label)}</div>
        </button>
        <div class="playlist-item-controls">
          <button type="button" class="playlist-item-btn" data-dir="up" title="Move up">▲</button>
          <button type="button" class="playlist-item-btn" data-dir="down" title="Move down">▼</button>
        </div>
        <button type="button" class="playlist-item-delete" title="Remove">×</button>
      `;
      row.querySelector(".playlist-item-main").onclick = () => playPlaylistItemById(item.id);
      const upBtn = row.querySelector('[data-dir="up"]');
      const downBtn = row.querySelector('[data-dir="down"]');
      upBtn.disabled = i === 0;
      downBtn.disabled = i === playlistItems.length - 1;
      upBtn.onclick = () => movePlaylistItem(i, i - 1);
      downBtn.onclick = () => movePlaylistItem(i, i + 1);
      row.querySelector(".playlist-item-delete").onclick = async () => {
        if (!confirm(`Remove "${item.label}" from the playlist?`)) return;
        try {
          const res = await fetch(`/api/playlist/${item.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
          loadPlaylist();
        } catch (err) {
          alert("Delete failed: " + err.message);
        }
      };
      playlistList.appendChild(row);
    });
  }

  async function loadSavedPlaylistOptions() {
    try {
      const res = await fetch("/api/playlist/saved");
      const data = await res.json();
      const playlists = data.playlists || [];
      savedPlaylistSelect.innerHTML =
        '<option value="">Load saved playlist…</option>' +
        playlists
          .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.itemCount})</option>`)
          .join("");
      savedPlaylistDeleteBtn.disabled = true;
    } catch (err) {
      console.error("Failed to load saved playlists:", err);
    }
  }

  playlistSaveAsBtn.onclick = async () => {
    const name = prompt("Save current playlist as:");
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/playlist/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      await loadSavedPlaylistOptions();
    } catch (err) {
      alert("Could not save playlist: " + err.message);
    }
  };

  savedPlaylistSelect.onchange = () => {
    savedPlaylistDeleteBtn.disabled = !savedPlaylistSelect.value;
  };

  savedPlaylistSelect.addEventListener("change", async () => {
    const id = savedPlaylistSelect.value;
    if (!id) return;
    const name = savedPlaylistSelect.selectedOptions[0].textContent;
    if (!confirm(`Load "${name}"? This replaces your current playlist.`)) {
      savedPlaylistSelect.value = "";
      savedPlaylistDeleteBtn.disabled = true;
      return;
    }
    try {
      const res = await fetch(`/api/playlist/saved/${id}/load`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed.");
      playlistItems = data.items;
      renderPlaylistStrip();
      renderPlaylistList();
    } catch (err) {
      alert("Could not load playlist: " + err.message);
    }
  });

  savedPlaylistDeleteBtn.onclick = async () => {
    const id = savedPlaylistSelect.value;
    if (!id) return;
    const name = savedPlaylistSelect.selectedOptions[0].textContent;
    if (!confirm(`Delete saved playlist "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/playlist/saved/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed.");
      await loadSavedPlaylistOptions();
    } catch (err) {
      alert("Could not delete saved playlist: " + err.message);
    }
  };

  async function movePlaylistItem(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= playlistItems.length) return;
    const ids = playlistItems.map((i) => i.id);
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    try {
      const res = await fetch("/api/playlist/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reorder failed");
      playlistItems = data.items;
      renderPlaylistStrip();
      renderPlaylistList();
    } catch (err) {
      alert("Reorder failed: " + err.message);
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("SW registration failed:", err));
    });
  }

  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.style.display = "inline-block";
  });
  installBtn.onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.style.display = "none";
  };
  window.addEventListener("appinstalled", () => {
    installBtn.style.display = "none";
  });

  // --- Bible Browser: OT/NT -> book -> chapter -> verse list, drill-down navigation.
  let bibleBooks = [];
  let bibleView = "books"; // "books" | "chapters" | "verses" — only used by the Back button
  let bibleSelectedBook = null;
  let bibleSelectedChapter = null;

  async function loadBibleBooks() {
    try {
      const res = await fetch("/api/bible/books");
      const data = await res.json();
      bibleBooks = data.books || [];
      renderBibleBooksList();
    } catch (err) {
      console.error("Failed to load Bible books:", err);
      bibleBrowserBody.innerHTML = '<div class="empty">Could not load books.</div>';
    }
  }

  function renderBibleBooksList() {
    bibleView = "books";
    bibleBackBtn.style.display = "none";
    bibleBreadcrumbLabel.textContent = "Old & New Testament";
    const ot = bibleBooks.filter((b) => b.id <= 39);
    const nt = bibleBooks.filter((b) => b.id >= 40);
    const bookRow = (b) =>
      `<div class="bible-book-item" data-book-id="${b.id}"><span>${escapeHtml(b.name)}</span><span>${b.chapters}</span></div>`;
    bibleBrowserBody.innerHTML =
      `<div class="bible-section-header">Old Testament</div>${ot.map(bookRow).join("")}` +
      `<div class="bible-section-header">New Testament</div>${nt.map(bookRow).join("")}`;
    bibleBrowserBody.querySelectorAll(".bible-book-item").forEach((el) => {
      el.onclick = () => {
        bibleSelectedBook = bibleBooks.find((b) => b.id === parseInt(el.dataset.bookId, 10));
        renderBibleChapterGrid();
      };
    });
  }

  function renderBibleChapterGrid() {
    bibleView = "chapters";
    bibleBackBtn.style.display = "inline-block";
    bibleBreadcrumbLabel.textContent = bibleSelectedBook.name;
    const buttons = [];
    for (let c = 1; c <= bibleSelectedBook.chapters; c++) {
      buttons.push(`<button class="bible-chapter-btn" data-chapter="${c}">${c}</button>`);
    }
    bibleBrowserBody.innerHTML = `<div class="bible-chapter-grid">${buttons.join("")}</div>`;
    bibleBrowserBody.querySelectorAll(".bible-chapter-btn").forEach((el) => {
      el.onclick = () => {
        bibleSelectedChapter = parseInt(el.dataset.chapter, 10);
        loadBibleVerses();
      };
    });
  }

  async function loadBibleVerses() {
    bibleView = "verses";
    bibleBackBtn.style.display = "inline-block";
    bibleBreadcrumbLabel.textContent = `${bibleSelectedBook.name} ${bibleSelectedChapter}`;
    bibleBrowserBody.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const translation = bibleTranslationSelect.value || "KJV";
      const res = await fetch(
        `/api/bible/chapter/${bibleSelectedBook.id}/${bibleSelectedChapter}?translation=${encodeURIComponent(translation)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load chapter");
      renderBibleVerseList(data.verses);
    } catch (err) {
      console.error("Failed to load chapter:", err);
      bibleBrowserBody.innerHTML = '<div class="empty">Could not load chapter.</div>';
    }
  }

  function renderBibleVerseList(verses) {
    bibleBrowserBody.innerHTML = verses
      .map(
        (v) => `
        <div class="bible-verse-row">
          <span class="bible-verse-num">${v.verse}</span>
          <span class="bible-verse-text">${escapeHtml(v.text)}</span>
          <button class="bible-verse-add" data-verse="${v.verse}" title="Add to Playlist">+</button>
          <button class="bible-verse-project" data-verse="${v.verse}">Project</button>
        </div>`
      )
      .join("");
    bibleBrowserBody.querySelectorAll(".bible-verse-project").forEach((el) => {
      el.onclick = () => {
        wsSend({
          type: "manual",
          bookId: bibleSelectedBook.id,
          bookName: bibleSelectedBook.name,
          chapter: bibleSelectedChapter,
          verse: parseInt(el.dataset.verse, 10),
        });
      };
    });
    bibleBrowserBody.querySelectorAll(".bible-verse-add").forEach((el) => {
      el.onclick = () => {
        const verse = parseInt(el.dataset.verse, 10);
        addToPlaylist("scripture", `${bibleSelectedBook.name} ${bibleSelectedChapter}:${verse}`, {
          bookId: bibleSelectedBook.id,
          bookName: bibleSelectedBook.name,
          chapter: bibleSelectedChapter,
          verse,
        });
      };
    });
  }

  bibleBackBtn.onclick = () => {
    if (bibleView === "verses") renderBibleChapterGrid();
    else if (bibleView === "chapters") renderBibleBooksList();
  };

  bibleTranslationSelect.onchange = () => {
    if (bibleView === "verses") loadBibleVerses();
  };

  // --- OBS Control: connection/recording status + click-to-switch scenes.
  // Polled over REST rather than pushed over the WS broadcast — unlike verse/
  // background state, this isn't something multiple operators need to agree
  // on, it's a side-channel to one local OBS instance.
  const OBS_POLL_MS = 8000;

  async function loadObsStatus() {
    try {
      const res = await fetch("/api/obs/status");
      renderObsStatus(await res.json());
    } catch (err) {
      console.error("Failed to load OBS status:", err);
    }
  }

  function applyObsBackgroundToggle(enabled) {
    obsBgToggleBtn.classList.toggle("active", Boolean(enabled));
  }

  obsBgToggleBtn.onclick = () => {
    wsSend({ type: "obs-toggle-background", enabled: !obsBgToggleBtn.classList.contains("active") });
  };

  function renderObsStatus(data) {
    obsStatusBadge.textContent = data.connected ? (data.recording ? "🔴 Recording" : "Connected") : "Disconnected";
    obsStatusBadge.classList.toggle("connected", data.connected);
    obsStatusBadge.classList.toggle("offline", !data.connected);

    if (!data.scenes.length) {
      obsScenesList.innerHTML = data.connected
        ? '<div class="empty" style="padding:4px 0">No scenes found.</div>'
        : '<div class="empty" style="padding:4px 0">Not connected — see README for OBS WebSocket setup.</div>';
      return;
    }
    obsScenesList.innerHTML = data.scenes
      .map(
        (s) =>
          `<button class="obs-scene-btn${s === data.currentScene ? " active" : ""}" data-scene="${escapeHtml(s)}">${escapeHtml(s)}</button>`
      )
      .join("");
    obsScenesList.querySelectorAll(".obs-scene-btn").forEach((el) => {
      el.onclick = () => {
        wsSend({ type: "obs-switch-scene", sceneName: el.dataset.scene });
        obsScenesList.querySelectorAll(".obs-scene-btn").forEach((b) => b.classList.remove("active"));
        el.classList.add("active");
        setTimeout(loadObsStatus, 600); // confirm against real OBS state shortly after
      };
    });
  }

  setInterval(loadObsStatus, OBS_POLL_MS);

  // --- Panel collapse: with six columns (Live Transcript, Verse
  // Suggestions/Preview, Bible Browser, Media Library, Song Library,
  // Service Playlist), screen space runs out fast. The four utility panels
  // can collapse to a narrow strip so whichever panels are actually in use
  // during a service get more room — state persists across reloads.
  const COLLAPSIBLE_PANELS = ["bible", "media", "song", "playlist"];
  const PANEL_WIDTHS = { bible: "320px", media: "320px", song: "320px", playlist: "320px" };
  const COLLAPSE_STORAGE_KEY = "sofer-collapsed-panels";
  const mainGrid = document.getElementById("mainGrid");

  function loadCollapsedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function applyGridColumns(collapsed) {
    const columns = ["1fr", "380px", ...COLLAPSIBLE_PANELS.map((p) => (collapsed.has(p) ? "44px" : PANEL_WIDTHS[p]))];
    mainGrid.style.gridTemplateColumns = columns.join(" ");
  }

  function setPanelCollapsed(panel, isCollapsed, collapsed) {
    const section = document.querySelector(`section[data-panel="${panel}"]`);
    const btn = section.querySelector("[data-collapse-toggle]");
    section.classList.toggle("collapsed", isCollapsed);
    btn.textContent = isCollapsed ? "›" : "‹";
    btn.title = isCollapsed ? "Expand this panel" : "Collapse this panel";
    if (isCollapsed) collapsed.add(panel);
    else collapsed.delete(panel);
  }

  const collapsedPanels = loadCollapsedSet();
  COLLAPSIBLE_PANELS.forEach((panel) => setPanelCollapsed(panel, collapsedPanels.has(panel), collapsedPanels));
  applyGridColumns(collapsedPanels);

  document.querySelectorAll("[data-collapse-toggle]").forEach((btn) => {
    const section = btn.closest("section[data-panel]");
    const panel = section.dataset.panel;
    btn.onclick = () => {
      setPanelCollapsed(panel, !section.classList.contains("collapsed"), collapsedPanels);
      applyGridColumns(collapsedPanels);
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedPanels]));
    };
  });

  // --- First-run guided walkthrough: a skippable spotlight tour over the
  // major panels, since the desktop installer now puts this console in
  // front of non-technical users with no one there to walk them through
  // it live. Runs once (localStorage flag), replayable via the header "?"
  // button or the desktop app's "Show Walkthrough" menu item.
  const TOUR_SEEN_KEY = "sofer-tour-seen";
  const TOUR_STEPS = [
    {
      selectors: ["#listenBtn", ".mode-toggle"],
      title: "Start Listening",
      body: "Begins live transcription and detects Bible references as they're spoken. Manual mode holds detected verses for your approval; Auto sends them straight to the display.",
    },
    {
      selectors: ["#suggestions"],
      title: "Verse Suggestions",
      body: "In Manual mode, detected references appear here as cards — click Approve to send one to the display, or Reject to dismiss it.",
    },
    {
      selectors: ["#preview-section"],
      title: "Projector Preview",
      body: "Shows exactly what's currently live on the projector display, so you always know what the congregation is seeing.",
    },
    {
      selectors: ["#manualInput"],
      title: "Manual Entry",
      body: 'If a reference is missed or misheard, type it here (e.g. "John 3:16") and click Show to send it straight to the display.',
    },
    {
      selectors: ["#customTextInput"],
      title: "Custom Text",
      body: "For announcements, welcome messages, or anything that isn't a Bible verse — type it here and click Project.",
    },
    {
      selectors: ["#background-bar"],
      title: "Backgrounds",
      body: "Pick a solid, gradient, or motion background for the projector — or upload your own image or video.",
    },
    {
      selectors: ['section[data-panel="bible"]'],
      title: "Bible Browser",
      body: "Browse any book, chapter, and verse and click to project it directly. Use the ‹ button in the corner to collapse this panel and free up room for others.",
    },
    {
      selectors: ['section[data-panel="media"]'],
      title: "Media Library",
      body: "Your catalog of backgrounds, motion graphics, logos, and lower thirds — searchable, with your own uploads mixed in.",
    },
    {
      selectors: ['section[data-panel="song"]'],
      title: "Song Library",
      body: "Songs broken into labeled sections (Verse 1, Chorus, etc.) — project a section and step through the rest with Prev/Next.",
    },
    {
      selectors: ['section[data-panel="playlist"]'],
      title: "Service Playlist",
      body: "Build an ordered list of verses, songs, custom text, and backgrounds ahead of time, then click through them live. Save it under a name to reuse next week.",
    },
  ];

  const tourOverlay = document.getElementById("tourOverlay");
  const tourHighlight = document.getElementById("tourHighlight");
  const tourCallout = document.getElementById("tourCallout");
  const tourTitle = document.getElementById("tourTitle");
  const tourBody = document.getElementById("tourBody");
  const tourProgress = document.getElementById("tourProgress");
  const tourSkipBtn = document.getElementById("tourSkipBtn");
  const tourBackBtn = document.getElementById("tourBackBtn");
  const tourNextBtn = document.getElementById("tourNextBtn");
  const tourHelpBtn = document.getElementById("tourHelpBtn");
  let tourStepIndex = 0;

  // Expands the step's target panel first if it's currently collapsed
  // (reusing the exact same functions the collapse buttons themselves
  // use), so replaying the tour after collapsing panels doesn't try to
  // spotlight a 44px-wide sliver.
  function ensureTourTargetsVisible(step) {
    step.selectors.forEach((sel) => {
      const el = document.querySelector(sel);
      const panelSection = el && el.closest("section[data-panel]");
      if (panelSection && panelSection.classList.contains("collapsed")) {
        const panel = panelSection.dataset.panel;
        setPanelCollapsed(panel, false, collapsedPanels);
        applyGridColumns(collapsedPanels);
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedPanels]));
      }
    });
  }

  function tourTargetRect(step) {
    const rects = step.selectors
      .map((sel) => document.querySelector(sel))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect());
    if (!rects.length) return null;
    const top = Math.min(...rects.map((r) => r.top));
    const left = Math.min(...rects.map((r) => r.left));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const right = Math.max(...rects.map((r) => r.right));
    return { top, left, bottom, right, width: right - left, height: bottom - top };
  }

  function renderTourStep(retriesLeft) {
    if (retriesLeft === undefined) retriesLeft = 1;
    const step = TOUR_STEPS[tourStepIndex];
    ensureTourTargetsVisible(step);
    const firstEl = document.querySelector(step.selectors[0]);
    if (firstEl) firstEl.scrollIntoView({ block: "center", behavior: "smooth" });

    // Give the collapse-expand/scroll CSS transitions a moment to settle
    // before measuring final positions.
    setTimeout(() => {
      const rect = tourTargetRect(step);
      if (!rect) {
        // Measuring can occasionally race the very first layout/scroll —
        // give it one retry before concluding the target really is missing
        // and skipping past this step.
        if (retriesLeft > 0) {
          renderTourStep(retriesLeft - 1);
        } else if (tourStepIndex < TOUR_STEPS.length - 1) {
          tourStepIndex++;
          renderTourStep();
        } else {
          endTour();
        }
        return;
      }

      tourHighlight.style.top = `${rect.top - 6}px`;
      tourHighlight.style.left = `${rect.left - 6}px`;
      tourHighlight.style.width = `${rect.width + 12}px`;
      tourHighlight.style.height = `${rect.height + 12}px`;

      tourTitle.textContent = step.title;
      tourBody.textContent = step.body;
      tourProgress.textContent = `${tourStepIndex + 1} / ${TOUR_STEPS.length}`;
      tourBackBtn.style.display = tourStepIndex === 0 ? "none" : "inline-block";
      tourNextBtn.textContent = tourStepIndex === TOUR_STEPS.length - 1 ? "Done" : "Next";

      const calloutWidth = 300;
      const margin = 12;
      let left = rect.left;
      if (left + calloutWidth + margin > window.innerWidth) left = window.innerWidth - calloutWidth - margin;
      if (left < margin) left = margin;
      const calloutHeightEstimate = 170;
      let top = rect.bottom + margin;
      if (top + calloutHeightEstimate > window.innerHeight) top = Math.max(margin, rect.top - calloutHeightEstimate - margin);
      tourCallout.style.left = `${left}px`;
      tourCallout.style.top = `${top}px`;
    }, 260);
  }

  function startTour() {
    tourStepIndex = 0;
    tourOverlay.style.display = "block";
    renderTourStep();
  }

  function endTour() {
    tourOverlay.style.display = "none";
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  }

  tourSkipBtn.onclick = endTour;
  tourBackBtn.onclick = () => {
    if (tourStepIndex > 0) {
      tourStepIndex--;
      renderTourStep();
    }
  };
  tourNextBtn.onclick = () => {
    if (tourStepIndex < TOUR_STEPS.length - 1) {
      tourStepIndex++;
      renderTourStep();
    } else {
      endTour();
    }
  };
  tourHelpBtn.onclick = startTour;

  if (!localStorage.getItem(TOUR_SEEN_KEY)) {
    setTimeout(startTour, 800);
  }

  loadTranslations();
  loadBackgroundPresets();
  loadBibleBooks();
  loadObsStatus();
  renderMediaTabs();
  loadMediaAssets();
  loadSongs();
  loadPlaylist();
  loadSavedPlaylistOptions();
  connectWs();
})();
