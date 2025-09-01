const { app, BrowserWindow, ipcMain, desktopCapturer } = require("electron");
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, "../renderer/index.html")}`;
  mainWindow.loadURL(startUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC: screen sources
ipcMain.handle("desktop-capturer:get-sources", async (event, opts) => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    fetchWindowIcons: true,
    thumbnailSize: { width: 200, height: 200 },
    ...opts,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    appIconDataUrl: s.appIcon ? s.appIcon.toDataURL() : null,
    thumbnailDataUrl: s.thumbnail ? s.thumbnail.toDataURL() : null,
  }));
});
