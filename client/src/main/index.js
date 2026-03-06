const { app, commandLine, session } = require("electron");
const { createWindow } = require("./window");
const { createTray } = require("./tray");
const { registerIpcHandlers } = require("./ipc-handlers");
const path = require("path");

// Prevent display issues with some graphics cards
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

app.whenReady().then(() => {
  // Register handlers
  registerIpcHandlers();

  createWindow();
  createTray();
});
