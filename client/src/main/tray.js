const { app, Tray, Menu } = require('electron');
const path = require('path');
const { getMainWindow, authorizeHideWindow } = require('./window');

let tray;

function createTray() {
    const iconPath = path.join(__dirname, '../../icons/icon.png');
    tray = new Tray(iconPath);
    tray.setToolTip('Kloak Client');

    tray.on('click', () => {
        let mainWindow = getMainWindow();
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                if (mainWindow.isFocused()) { authorizeHideWindow(); mainWindow.hide(); }
                else { mainWindow.show(); mainWindow.focus(); }
            } else {
                mainWindow.show(); mainWindow.focus();
            }
        }
    });

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open', click: () => { let m = getMainWindow(); if(m) { m.show(); m.focus(); } } },
        { label: 'Restart', click: () => {
            const restartOptions = { args: process.argv.slice(1) };
            if (process.env.APPIMAGE) {
                restartOptions.execPath = process.env.APPIMAGE;
                restartOptions.args.unshift('--appimage-extract-and-run');
            }
            app.relaunch(restartOptions);
            app.exit(0);
        } },
        { type: 'separator' },
        { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
}

module.exports = { createTray };
