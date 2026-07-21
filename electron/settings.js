(() => {
  const deepgramApiKey = document.getElementById("deepgramApiKey");
  const obsWebsocketUrl = document.getElementById("obsWebsocketUrl");
  const obsWebsocketPassword = document.getElementById("obsWebsocketPassword");
  const motionBackgroundsDir = document.getElementById("motionBackgroundsDir");
  const browseBtn = document.getElementById("browseBtn");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  async function load() {
    const config = await window.soferSettings.getConfig();
    deepgramApiKey.value = config.deepgramApiKey || "";
    obsWebsocketUrl.value = config.obsWebsocketUrl || "";
    obsWebsocketPassword.value = config.obsWebsocketPassword || "";
    motionBackgroundsDir.value = config.motionBackgroundsDir || "";
  }

  browseBtn.onclick = async () => {
    const folder = await window.soferSettings.pickFolder();
    if (folder) motionBackgroundsDir.value = folder;
  };

  saveBtn.onclick = async () => {
    if (!deepgramApiKey.value.trim()) {
      status.textContent = "Deepgram API Key is required.";
      status.className = "err";
      return;
    }
    await window.soferSettings.saveConfig({
      deepgramApiKey: deepgramApiKey.value.trim(),
      obsWebsocketUrl: obsWebsocketUrl.value.trim(),
      obsWebsocketPassword: obsWebsocketPassword.value.trim(),
      motionBackgroundsDir: motionBackgroundsDir.value.trim(),
    });
    status.textContent = "Saved — restarting…";
    status.className = "ok";
    setTimeout(() => window.soferSettings.relaunch(), 600);
  };

  load();
})();
