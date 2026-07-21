const { app, BrowserWindow, Menu, screen, ipcMain, dialog, session } = require("electron");
const path = require("path");
const fs = require("fs");

// Settings live here instead of a hand-edited .env — this is the whole
// point of packaging as a desktop app for non-technical users.
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_CONFIG = {
  deepgramApiKey: "",
  obsWebsocketUrl: "",
  obsWebsocketPassword: "",
  motionBackgroundsDir: "",
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

const config = loadConfig();

// Set process.env from saved settings *before* requiring server.js — it
// reads these once at module load. dotenv's own `.config()` call inside
// server.js won't override anything already set here (dotenv defaults to
// override:false), and safely no-ops if there's no .env file, which is
// the normal case for an installed app.
if (config.deepgramApiKey) process.env.DEEPGRAM_API_KEY = config.deepgramApiKey;
if (config.obsWebsocketUrl) process.env.OBS_WEBSOCKET_URL = config.obsWebsocketUrl;
if (config.obsWebsocketPassword) process.env.OBS_WEBSOCKET_PASSWORD = config.obsWebsocketPassword;

// Both of these default to locations relative to the installed app's own
// files, which are read-only (or simply gone) once packaged — redirect
// them into the OS-appropriate per-user app-data directory instead.
process.env.MOTION_BACKGROUNDS_DIR = config.motionBackgroundsDir || path.join(app.getPath("userData"), "motion-backgrounds");
process.env.DB_PATH = process.env.DB_PATH || path.join(app.getPath("userData"), "app.db");
fs.mkdirSync(process.env.MOTION_BACKGROUNDS_DIR, { recursive: true });

require(path.join(__dirname, "..", "server.js"));
const PORT = process.env.PORT || 3000;

let operatorWindow = null;
let displayWindow = null;
let settingsWindow = null;

// The embedded server starts listening asynchronously; a fresh window's
// first loadURL can race it and fail with a connection error, so retry
// briefly instead of adding any readiness signal to server.js itself.
function loadWithRetry(win, url, attempt = 0) {
  win.loadURL(url).catch(() => {
    if (attempt < 30 && !win.isDestroyed()) setTimeout(() => loadWithRetry(win, url, attempt + 1), 150);
  });
}

function createOperatorWindow() {
  if (operatorWindow) {
    operatorWindow.focus();
    return;
  }
  operatorWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Sofer 2.0 — Operator Console",
    icon: path.join(__dirname, "..", "public", "icons", "icon-512.png"),
    webPreferences: { contextIsolation: true },
  });
  loadWithRetry(operatorWindow, `http://localhost:${PORT}/operator.html`);
  operatorWindow.on("closed", () => {
    operatorWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    title: "Sofer 2.0 Settings",
    resizable: false,
    icon: path.join(__dirname, "..", "public", "icons", "icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createDisplayWindow(displayId) {
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close();
  displayWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    fullscreen: true,
    webPreferences: { contextIsolation: true },
  });
  loadWithRetry(displayWindow, `http://localhost:${PORT}/display.html`);
  displayWindow.on("closed", () => {
    displayWindow = null;
  });
}

function buildMenu() {
  const primary = screen.getPrimaryDisplay();
  const secondaryDisplays = screen.getAllDisplays().filter((d) => d.id !== primary.id);

  const template = [
    {
      label: "Sofer 2.0",
      submenu: [
        { label: "Settings…", click: createSettingsWindow },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Display",
      submenu: [
        { label: "Show Display Output (this screen)", click: () => createDisplayWindow(primary.id) },
        ...secondaryDisplays.map((d, i) => ({
          label: `Show on Projector (Display ${i + 2})`,
          click: () => createDisplayWindow(d.id),
        })),
        { type: "separator" },
        { label: "Reload Operator Console", click: () => operatorWindow && operatorWindow.reload() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (event, partial) => saveConfig(partial));
ipcMain.handle("pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("list-displays", () =>
  screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, isPrimary: d.id === screen.getPrimaryDisplay().id }))
);
ipcMain.handle("relaunch", () => {
  app.relaunch();
  app.exit();
});

app.whenReady().then(() => {
  // Chrome (and a plain browser tab) prompts the user for mic access;
  // Electron's default session blocks it silently unless explicitly
  // allowed — without this, "Start Listening" would just do nothing.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  buildMenu();
  if (!config.deepgramApiKey) {
    createSettingsWindow();
  } else {
    createOperatorWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createOperatorWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
