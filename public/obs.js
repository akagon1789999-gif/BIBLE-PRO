(() => {
  const stage = document.getElementById("stage");
  const verseText = document.getElementById("verseText");
  const verseRef = document.getElementById("verseRef");
  let ws = null;

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Reuses the same "display" role as the projector page — same show/clear
    // broadcasts, just rendered without any background (this page ignores
    // "background" messages entirely; it's always transparent for OBS).
    ws = new WebSocket(`${proto}//${location.host}/ws?role=display`);
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "show") showVerse(msg);
      if (msg.type === "clear") hide();
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

  connect();
})();
