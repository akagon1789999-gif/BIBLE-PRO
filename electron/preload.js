const { contextBridge, ipcRenderer } = require("electron");

// Only exposed to the Settings window — the Operator/Display windows load
// plain http:// pages with no preload at all, since they need nothing
// beyond what a normal browser tab already gives them.
contextBridge.exposeInMainWorld("soferSettings", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (partial) => ipcRenderer.invoke("save-config", partial),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  listDisplays: () => ipcRenderer.invoke("list-displays"),
  relaunch: () => ipcRenderer.invoke("relaunch"),
});
