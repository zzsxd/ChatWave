const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatWaveDesktop", {
  platform: process.platform,
  supportsSystemAudio: process.platform === "win32",
  getScreenSources: () => ipcRenderer.invoke("chatwave:screen-sources"),
  selectScreenSource: (sourceId, withAudio) =>
    ipcRenderer.invoke(
      "chatwave:select-screen-source",
      sourceId,
      Boolean(withAudio),
    ),
  cancelScreenSource: () =>
    ipcRenderer.invoke("chatwave:cancel-screen-source"),
  getDesktopSettings: () =>
    ipcRenderer.invoke("chatwave:desktop-settings"),
  updateDesktopSettings: (changes) =>
    ipcRenderer.invoke("chatwave:update-desktop-settings", changes),
  getUpdateStatus: () => ipcRenderer.invoke("chatwave:update-status"),
  checkForUpdates: () => ipcRenderer.invoke("chatwave:check-update"),
  downloadUpdate: () => ipcRenderer.invoke("chatwave:download-update"),
  installUpdate: () => ipcRenderer.invoke("chatwave:install-update"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("chatwave:update-state", listener);
    return () => ipcRenderer.removeListener("chatwave:update-state", listener);
  },
});
