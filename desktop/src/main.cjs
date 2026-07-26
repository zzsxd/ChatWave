const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  session,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

const APP_URL =
  process.env.CHATWAVE_APP_URL ??
  "https://app.chatwave.62-113-44-238.sslip.io";
const APP_ORIGIN = new URL(APP_URL).origin;
let selectedDisplaySource = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let desktopSettings = {
  closeToTray: false,
  zoomFactor: 1,
};
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: 0,
  error: null,
};

function publishUpdateState(changes = {}) {
  updateState = { ...updateState, ...changes };
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("chatwave:update-state", updateState);
    }
  });
  return updateState;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.channel = process.arch === "arm64" ? "latest-arm64" : "latest-x64";
  autoUpdater.on("checking-for-update", () =>
    publishUpdateState({ status: "checking", error: null }),
  );
  autoUpdater.on("update-available", (info) =>
    publishUpdateState({
      status: "available",
      availableVersion: info.version,
      progress: 0,
      error: null,
    }),
  );
  autoUpdater.on("update-not-available", () =>
    publishUpdateState({
      status: "current",
      availableVersion: null,
      progress: 0,
      error: null,
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    publishUpdateState({
      status: "downloading",
      progress: Math.round(progress.percent),
      error: null,
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    publishUpdateState({
      status: "downloaded",
      availableVersion: info.version,
      progress: 100,
      error: null,
    }),
  );
  autoUpdater.on("error", (error) =>
    publishUpdateState({
      status: "error",
      error: error?.message || "Не удалось проверить обновление",
    }),
  );
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function settingsFile() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function loadDesktopSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    desktopSettings = {
      closeToTray: Boolean(saved.closeToTray),
      zoomFactor:
        typeof saved.zoomFactor === "number"
          ? Math.min(2, Math.max(0.8, saved.zoomFactor))
          : 1,
    };
  } catch {
    // Defaults are used on first launch or after a damaged settings file.
  }
}

function saveDesktopSettings() {
  fs.writeFileSync(
    settingsFile(),
    JSON.stringify(desktopSettings, null, 2),
    "utf8",
  );
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function bundledIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(__dirname, "..", "build", "icon.png");
}

function ensureTray() {
  if (tray || !desktopSettings.closeToTray) return;
  tray = new Tray(bundledIconPath());
  tray.setToolTip("ChatWave");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть ChatWave", click: showMainWindow },
      { type: "separator" },
      {
        label: "Выйти",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showMainWindow);
}

function removeTray() {
  tray?.destroy();
  tray = null;
}

function isTrustedFrame(frame) {
  try {
    return new URL(frame.url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function isTrustedOrigin(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

async function screenSources() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    fetchWindowIcons: true,
    thumbnailSize: { width: 480, height: 270 },
  });
  return sources.map((source) => ({
    id: source.id,
    kind: source.id.startsWith("screen:") ? "screen" : "window",
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon?.toDataURL() ?? null,
  }));
}

function configureDesktopCapture(chatWaveSession) {
  chatWaveSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const selected = selectedDisplaySource;
        selectedDisplaySource = null;
        if (
          !selected ||
          !request.videoRequested ||
          !isTrustedOrigin(request.securityOrigin) ||
          !isTrustedFrame(request.frame)
        ) {
          callback({});
          return;
        }
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          fetchWindowIcons: false,
          thumbnailSize: { width: 0, height: 0 },
        });
        const source = sources.find((item) => item.id === selected.sourceId);
        if (!source) {
          callback({});
          return;
        }
        callback({
          video: source,
          ...(selected.withAudio &&
          request.audioRequested &&
          process.platform === "win32"
            ? { audio: "loopback" }
            : {}),
        });
      } catch {
        selectedDisplaySource = null;
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function configurePermissions(chatWaveSession) {
  const allowed = new Set([
    "media",
    "display-capture",
    "notifications",
    "fullscreen",
    "pointerLock",
  ]);
  chatWaveSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      isTrustedOrigin(requestingOrigin) && allowed.has(permission),
  );
  chatWaveSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(
        isTrustedFrame(webContents.mainFrame) && allowed.has(permission),
      );
    },
  );
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#070b12",
    autoHideMenuBar: true,
    show: false,
    icon: bundledIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      backgroundThrottling: false,
      partition: "persist:chatwave",
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setZoomFactor(desktopSettings.zoomFactor);
  window.on("close", (event) => {
    if (!isQuitting && desktopSettings.closeToTray) {
      event.preventDefault();
      window.hide();
      ensureTray();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (protocol === "https:" || protocol === "http:") {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid and non-web URLs remain blocked.
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.loadURL(APP_URL);
  return window;
}

ipcMain.handle("chatwave:screen-sources", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  return screenSources();
});

ipcMain.handle(
  "chatwave:select-screen-source",
  async (event, sourceId, withAudio) => {
    if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
    if (typeof sourceId !== "string" || sourceId.length > 512) {
      throw new Error("Invalid source");
    }
    selectedDisplaySource = {
      sourceId,
      withAudio: Boolean(withAudio),
    };
  },
);

ipcMain.handle("chatwave:cancel-screen-source", async (event) => {
  if (isTrustedFrame(event.senderFrame)) selectedDisplaySource = null;
});

ipcMain.handle("chatwave:desktop-settings", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  return desktopSettings;
});

ipcMain.handle("chatwave:update-desktop-settings", async (event, changes) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  if (typeof changes?.closeToTray === "boolean") {
    desktopSettings.closeToTray = changes.closeToTray;
    if (changes.closeToTray) ensureTray();
    else removeTray();
  }
  if (typeof changes?.zoomFactor === "number") {
    desktopSettings.zoomFactor = Math.min(
      2,
      Math.max(0.8, changes.zoomFactor),
    );
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.setZoomFactor(desktopSettings.zoomFactor),
    );
  }
  saveDesktopSettings();
  return desktopSettings;
});

ipcMain.handle("chatwave:update-status", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  return updateState;
});

ipcMain.handle("chatwave:check-update", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  if (!app.isPackaged) {
    return publishUpdateState({
      status: "current",
      error: null,
      availableVersion: null,
    });
  }
  await autoUpdater.checkForUpdates();
  return updateState;
});

ipcMain.handle("chatwave:download-update", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  await autoUpdater.downloadUpdate();
  return updateState;
});

ipcMain.handle("chatwave:install-update", async (event) => {
  if (!isTrustedFrame(event.senderFrame)) throw new Error("Untrusted frame");
  isQuitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    loadDesktopSettings();
    configureAutoUpdater();
    if (process.platform === "win32") {
      app.setAppUserModelId("io.chatwave.desktop");
    }
    const chatWaveSession = session.fromPartition("persist:chatwave");
    configureDesktopCapture(chatWaveSession);
    configurePermissions(chatWaveSession);
    mainWindow = createWindow();
    ensureTray();
    app.on("activate", () => {
      showMainWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("destroyed", () => {
    selectedDisplaySource = null;
  });
});

app.on("window-all-closed", () => {
  if (
    process.platform !== "darwin" &&
    (!desktopSettings.closeToTray || isQuitting)
  ) {
    app.quit();
  }
});
