(() => {
  const stage = document.getElementById("stage");
  const verseText = document.getElementById("verseText");
  const verseRef = document.getElementById("verseRef");
  const bgVideo = document.getElementById("bgVideo");
  let ws = null;
  // Latest background from the server, and whether the operator has opted
  // into painting it here — off by default, since this page is normally
  // transparent over a live camera feed (see obs.html's comment).
  let latestBackground = null;
  let showBackgroundEnabled = false;

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Reuses the same "display" role as the projector page — same show/clear/
    // background broadcasts; background is only painted when explicitly
    // enabled via the OBS Control panel's toggle.
    ws = new WebSocket(`${proto}//${location.host}/ws?role=display`);
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "show") showVerse(msg);
      if (msg.type === "clear") hide();
      if (msg.type === "background") {
        latestBackground = msg.background;
        if (showBackgroundEnabled) applyBackground(latestBackground);
      }
      if (msg.type === "obs-background-toggle") {
        showBackgroundEnabled = Boolean(msg.enabled);
        if (showBackgroundEnabled) applyBackground(latestBackground);
        else clearBackground();
      }
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }

  function applyBackground(background) {
    if (!background) return;
    if (background.type === "video") {
      document.body.style.background = "#000000";
      if (bgVideo.src !== new URL(background.url, location.href).href) {
        bgVideo.src = background.url;
      }
      bgVideo.style.display = "block";
      bgVideo.play().catch(() => {});
    } else {
      bgVideo.pause();
      bgVideo.removeAttribute("src");
      bgVideo.style.display = "none";
      document.body.style.background =
        background.type === "image" ? `center / cover no-repeat url("${background.url}")` : background.css;
    }
  }

  function clearBackground() {
    bgVideo.pause();
    bgVideo.removeAttribute("src");
    bgVideo.style.display = "none";
    document.body.style.background = "transparent";
  }

  function formatRef(msg) {
    if (msg.isChapterOnly) return `${msg.bookName} ${msg.chapter} (${msg.translation})`;
    const verses = msg.verseEnd ? `${msg.verse}-${msg.verseEnd}` : msg.verse;
    return `${msg.bookName} ${msg.chapter}:${verses} (${msg.translation})`;
  }

  function showVerse(msg) {
    if (msg.custom) {
      // Server already sanitized this HTML (lib/richText.js) — safe to render directly.
      verseText.innerHTML = msg.html || "";
      verseText.className = `size-${msg.fontSize || "normal"}`;
      verseRef.textContent = "";
      verseRef.style.display = "none";
    } else {
      verseText.textContent = msg.text || "";
      verseText.className = "size-normal";
      verseRef.textContent = formatRef(msg);
      verseRef.style.display = "";
    }
    stage.classList.add("visible");
  }

  function hide() {
    stage.classList.remove("visible");
  }

  connect();
})();
