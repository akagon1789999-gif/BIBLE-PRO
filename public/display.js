(() => {
  const stage = document.getElementById("stage");
  const verseText = document.getElementById("verseText");
  const verseRef = document.getElementById("verseRef");
  const bgVideo = document.getElementById("bgVideo");
  let ws = null;

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?role=display`);
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "show") showVerse(msg);
      if (msg.type === "clear") hide();
      if (msg.type === "background") applyBackground(msg.background);
    };
    ws.onclose = () => setTimeout(connect, 1500);
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

  connect();
})();
