const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  desktopCapturer,
} = require("electron");
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

// IPC: dialogs for file transfer
ipcMain.handle("dialog:open-file", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:save-file", async (event, suggestedName) => {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName || "received.file",
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// IPC: file operations
ipcMain.handle("fs:read-file", (event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );
    return ab;
  } catch (err) {
    throw new Error("Failed to read file");
  }
});

ipcMain.handle("fs:write-file", (event, filePath, data) => {
  try {
    let buffer;
    if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else if (typeof data === "string") {
      buffer = Buffer.from(data, "base64");
    } else {
      throw new Error("Unsupported data type");
    }
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (err) {
    throw new Error("Failed to write file");
  }
});
