const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { loadSettings, saveSettings } = require("./services/settings");
const {
  handlePermissionRequest,
  pendingPermissions,
} = require("./services/permissions");
const { checkForCustomUpdate } = require("./services/updater");

let mainWindow;
let screenSources = [];
let screenShareCallback = null;
let shouldHideOnClose = false;
let allowHideUntil = 0;

function getMainWindow() {
  return mainWindow;
}

function getScreenState() {
  return { screenSources, screenShareCallback };
}

function setScreenShareCallback(cb) {
  screenShareCallback = cb;
}

function setScreenSources(sources) {
  screenSources = sources;
}

function requestHideOnClose() {
  shouldHideOnClose = true;
}

function authorizeHideWindow(durationMs = 1500) {
  allowHideUntil = Date.now() + durationMs;
}

function createWindow() {
  let appSettings = loadSettings();

  let splashWindow = new BrowserWindow({
    width: 350,
    height: 450,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    icon: path.join(__dirname, "../../icons/icon.png"),
  });

  splashWindow.loadFile(path.join(__dirname, "../../splash.html"));

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    titleBarStyle: "hidden",
    ...(process.platform !== "darwin"
      ? {
          titleBarOverlay: {
            color: "#0f0f0f",
            symbolColor: "#d6d9df",
            height: 36,
          },
        }
      : {}),
    backgroundColor: "#0f0f0f",
    show: false,
    icon: path.join(__dirname, "../../icons/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:kloak",
      experimentalFeatures: true,
    },
  });

  const appSession = session.fromPartition("persist:kloak");

  const appUserAgent =
    mainWindow.webContents.getUserAgent() + " KloakClient Electron Tauri";
  mainWindow.webContents.setUserAgent(appUserAgent);

  mainWindow.webContents.on("did-finish-load", () => {
    try {
      // Inject CSS
      let stylesPath = path.join(
        app.getAppPath(),
        "src",
        "renderer",
        "styles.css",
      );
      if (fs.existsSync(stylesPath)) {
        const cssCode = fs.readFileSync(stylesPath, "utf8");
        mainWindow.webContents.insertCSS(cssCode);
      }

      // Inject Modal Renderer
      let modalRendererPath = path.join(
        app.getAppPath(),
        "src",
        "renderer",
        "modal-renderer.js",
      );
      if (fs.existsSync(modalRendererPath)) {
        const modalCode = fs.readFileSync(modalRendererPath, "utf8");
        mainWindow.webContents.executeJavaScript(modalCode);
      }

      // Inject Native Features (quick edit)
      let nativeFeaturesPath = path.join(
        app.getAppPath(),
        "src",
        "renderer",
        "native-features.js",
      );
      if (fs.existsSync(nativeFeaturesPath)) {
        const nativeFeaturesCode = fs.readFileSync(nativeFeaturesPath, "utf8");
        mainWindow.webContents
          .executeJavaScript(nativeFeaturesCode)
          .catch(console.error);
      }

    } catch (err) {
      console.error("Renderer injection sequence failed:", err);
    }
  });

  mainWindow.loadURL("https://kloak.app/app");

  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      mainWindow.show();
      mainWindow.focus();

      // Trigger update check from main process directly
      const fakeEvent = {
        reply: (channel, data) => mainWindow.webContents.send(channel, data),
      };
      checkForCustomUpdate(fakeEvent);

      // Re-check for updates every 5 minutes
      setInterval(
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const intervalEvent = {
              reply: (channel, data) =>
                mainWindow.webContents.send(channel, data),
            };
            checkForCustomUpdate(intervalEvent);
          }
        },
        5 * 60 * 1000,
      );

      if (!appSettings.firstLaunchDone) {
        const permsToAsk = ["media", "notifications"];
        let currentIdx = 0;

        function promptNext() {
          if (currentIdx >= permsToAsk.length) {
            // Reload to get any permissions saved by handlePermissionResponse
            let finalSettings = loadSettings();
            finalSettings.firstLaunchDone = true;
            saveSettings(finalSettings);
            return;
          }
          const perm = permsToAsk[currentIdx];
          currentIdx++;
          if (
            appSettings.savedPermissions &&
            appSettings.savedPermissions[perm] === true
          ) {
            promptNext();
            return;
          }
          const reqId = `first-launch-${perm}-${Date.now()}`;
          pendingPermissions[reqId] = {
            permission: perm,
            callback: (allowed) => {
              // Permission is already saved by handlePermissionResponse in permissions service
              setTimeout(promptNext, 400);
            },
          };
          mainWindow.webContents.send("show-custom-permission", {
            id: reqId,
            permission: perm,
          });
        }
        setTimeout(promptNext, 2000);
      }
    }, 500);
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) {
      event.preventDefault();
      return;
    }
    // Redirect external links (non-kloak) to the system browser
    if (
      !url.startsWith("https://kloak.app") &&
      !url.startsWith("http://kloak.app")
    ) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("file://")) return { action: "deny" };
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.insertCSS(`
        html, body { overflow: hidden; background: transparent !important; }
        #app, #root, body > div:first-child { background-color: #0f0f0f !important; transition: background-color 0.2s ease; height: 100vh; width: 100vw; }
        .h-9.w-full.border-b { -webkit-app-region: drag !important; user-select: none; padding-right: 140px !important; min-height: 36px !important; }
        .h-9.w-full.border-b button { -webkit-app-region: no-drag !important; cursor: pointer !important; }
        .h-9.w-full.border-b [aria-label^="Minim"],
        .h-9.w-full.border-b [aria-label^="Maxim"],
        .h-9.w-full.border-b [aria-label="Close"] {
          display: none !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }
        * { backdrop-filter: none !important; }
        `);
  });

  appSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      handlePermissionRequest(
        webContents,
        permission,
        callback,
        details,
        mainWindow,
      );
    },
  );

  mainWindow.on("maximize", () => {
    mainWindow.webContents
      .executeJavaScript(
        'document.documentElement.classList.add("kloak-maximized"); document.body.classList.add("kloak-maximized");',
      )
      .catch(() => {});
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents
      .executeJavaScript(
        'document.documentElement.classList.remove("kloak-maximized"); document.body.classList.remove("kloak-maximized");',
      )
      .catch(() => {});
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      if (shouldHideOnClose) {
        shouldHideOnClose = false;
        authorizeHideWindow();
        mainWindow.hide();
      } else {
        authorizeHideWindow();
        mainWindow.hide();
      }
      return false;
    }
  });

  mainWindow.on("hide", () => {
    if (app.isQuiting) return;

    // Only allow intentional hides (tray/close-to-tray). Unexpected hides are reversed.
    if (Date.now() > allowHideUntil) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      }, 50);
    }
  });

  appSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 300, height: 300 },
      })
      .then((sources) => {
        setScreenSources(sources);
        setScreenShareCallback(callback);
        const cleanSources = sources.map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.id.startsWith("screen:") ? "screen" : "window",
          thumbnail: source.thumbnail.toDataURL(),
        }));
        mainWindow.webContents.send("show-screen-picker", cleanSources);
      })
      .catch((err) => {
        console.error("Error getting screen sources:", err);
        callback(null);
      });
  });

  return mainWindow;
}

module.exports = {
  createWindow,
  getMainWindow,
  getScreenState,
  setScreenShareCallback,
  setScreenSources,
  requestHideOnClose,
  authorizeHideWindow,
};
