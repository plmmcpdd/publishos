import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('PublishOS');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open PublishOS', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Queue: 0 pending', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

// IPC handlers
ipcMain.handle('device:get-id', async () => {
  // TODO: generate stable hardware-bound device ID
  return `device_${Date.now()}`;
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

ipcMain.on('window:minimize', () => {
  mainWindow?.hide();
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep app running in background (tray mode)
  if (process.platform !== 'darwin') {
    // On Windows/Linux, hide instead of quit
    // mainWindow?.hide();
  }
});

app.on('before-quit', () => {
  tray?.destroy();
});
