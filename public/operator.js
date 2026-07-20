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

  let ws = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let listening = false;
  let finalTranscriptLog = [];
  let availableTranslations = [];
  let popularTranslationCodes = [];
  let recordedChunks = []; // audio Blobs from every Start Listening session, for local download only
  let currentMode = "manual"; // re-sent to the server on every (re)connect — see set-mode below

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

    listening = false;
    statusDot.classList.remove("live");
    listenBtn.textContent = "Start Listening";
  }

  listenBtn.onclick = () => {
    if (!listening) startListening();
    else stopListening();
  };

  clearBtn.onclick = () => wsSend({ type: "clear" });

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

  loadTranslations();
  loadBackgroundPresets();
  connectWs();
})();
