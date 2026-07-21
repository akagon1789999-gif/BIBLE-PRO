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

  let ws = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let listening = false;
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

    listening = true;
    statusDot.classList.add("live");
    listenBtn.textContent = "Stop Listening";
  }

  function stopListening() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    mediaStream = null;
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
      liveTranslationSelect.style.display = "";
      if (liveTranslationSelect.value !== msg.translation) liveTranslationSelect.value = msg.translation;
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

  async function loadBackgroundPresets() {
    try {
      const res = await fetch("/api/backgrounds");
      const data = await res.json();
      (data.presets || []).forEach((preset) => {
        const background = { type: "preset", id: preset.id, css: preset.css };
        bgSwatchesEl.appendChild(renderSwatch(background, preset.label));
      });
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
      const background = { type: data.type, url: data.url };
      bgSwatchesEl.appendChild(renderSwatch(background, file.name));
      selectBackground(background);
    } catch (err) {
      alert("Background upload failed: " + err.message);
    } finally {
      bgUploadBtn.disabled = false;
      bgUploadBtn.textContent = "Upload Image/Video";
      bgFileInput.value = "";
    }
  };

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

  loadTranslations();
  loadBackgroundPresets();
  loadBibleBooks();
  loadObsStatus();
  connectWs();
})();
