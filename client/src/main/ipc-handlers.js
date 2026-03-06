const { app, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  getMainWindow,
  getScreenState,
  setScreenShareCallback,
  setScreenSources,
  requestHideOnClose,
} = require("./window");
const { handlePermissionResponse } = require("./services/permissions");
const {
  checkForCustomUpdate,
  downloadUpdate,
  installAndRestart,
  triggerDebugUpdate,
} = require("./services/updater");

function registerIpcHandlers() {
  ipcMain.on("terminal-log", (event, msg) => {
    console.log(`[Renderer] ${msg}`);
  });

  ipcMain.on("window-min", () => {
    console.log("[IPC] window-min received");
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on("window-max", () => {
    console.log("[IPC] window-max received");
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();

      // Some environments report fullscreen separately from maximized.
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }

      // Ensure the window remains visible/focused after state transitions.
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.on("window-close", () => {
    console.log("[IPC] window-close received");
    const mainWindow = getMainWindow();
    if (mainWindow) {
      requestHideOnClose();
      mainWindow.close();
    }
  });

  ipcMain.on("permission-response", (event, { id, allowed }) => {
    console.log("[IPC] permission-response received:", { id, allowed });
    handlePermissionResponse(id, allowed);
  });

  ipcMain.on("screen-share-selected", (event, sourceId) => {
    console.log("[IPC] screen-share-selected received:", sourceId);
    let { screenSources, screenShareCallback } = getScreenState();
    if (screenShareCallback) {
      if (sourceId) {
        const chosenSource = screenSources.find((s) => s.id === sourceId);
        if (chosenSource) screenShareCallback({ video: chosenSource });
        else screenShareCallback(null);
      } else {
        screenShareCallback(null);
      }
      setScreenShareCallback(null);
      setScreenSources([]);
    }
  });

  ipcMain.on("check-custom-update", (event) => {
    console.log("[IPC] check-custom-update received");
    checkForCustomUpdate(event);
  });

  ipcMain.on("debug-update-trigger", (event) => {
    console.log("[IPC] debug-update-trigger received");
    triggerDebugUpdate(event);
  });

  ipcMain.on("open-external-url", (event, url) => {
    console.log("[IPC] open-external-url received:", url);
    if (url) shell.openExternal(url);
  });

  ipcMain.on("start-update", (event, { version }) => {
    console.log("[IPC] start-update received:", { version });
    downloadUpdate(event, { version, platform: process.platform });
  });

  ipcMain.on("quit-and-install", () => {
    console.log("[IPC] quit-and-install received");
    installAndRestart();
  });

  const featureConfigPath = path.join(app.getPath("userData"), "feature-config.json");

  ipcMain.handle("get-feature-config", () => {
    try {
      if (fs.existsSync(featureConfigPath)) {
        return JSON.parse(fs.readFileSync(featureConfigPath, "utf8"));
      }
    } catch (e) {}
    return {};
  });

  ipcMain.handle("save-feature-config", (event, data) => {
    try {
      fs.writeFileSync(featureConfigPath, JSON.stringify(data, null, 4));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerIpcHandlers };
