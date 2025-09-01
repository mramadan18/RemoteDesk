const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  clipboard,
} = require("electron");
const os = require("os");
let nut;
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false, // Required for screen sharing in some cases
    },
    icon: path.join(__dirname, "../../assets/icon.png"), // Add icon later if needed
    titleBarStyle: "default",
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

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

// IPC handlers for main process communication
ipcMain.handle("get-user-id", () => {
  // Return a persistent user ID (could be stored in a file or generated based on system info)
  return require("crypto").randomBytes(4).toString("hex").toUpperCase();
});

// Handle screen sharing permissions
ipcMain.handle("get-desktop-capturer-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 150, height: 150 },
    });
    return sources;
  } catch (error) {
    console.error("Error getting desktop sources:", error);
    return [];
  }
});

// Handle screen sharing stream creation (returns source info for renderer to use)
ipcMain.handle("get-screen-source-info", async (event, sourceId) => {
  try {
    // Use Electron's desktopCapturer to get screen sources
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
    });

    // Find the requested source or return the first available screen
    let source;
    if (sourceId) {
      source = sources.find((s) => s.id === sourceId);
    } else {
      source = sources.find(
        (s) =>
          s.name.toLowerCase().includes("screen") ||
          s.name.toLowerCase().includes("display")
      );
      if (!source) source = sources[0]; // Fallback to first source
    }

    if (!source) {
      throw new Error("No screen source available");
    }

    return {
      id: source.id,
      name: source.name,
      display_id: source.display_id,
    };
  } catch (error) {
    console.error("Error getting screen source info:", error);
    throw error;
  }
});

// Handle clipboard operations
ipcMain.handle("clipboard-write-text", async (event, text) => {
  try {
    clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Error writing to clipboard:", error);
    throw error;
  }
});

ipcMain.handle("clipboard-read-text", async () => {
  try {
    return clipboard.readText();
  } catch (error) {
    console.error("Error reading from clipboard:", error);
    throw error;
  }
});

// Handle permission requests
app.on("web-contents-created", (event, contents) => {
  contents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = ["media", "desktop-capture"];

      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    }
  );
});

// Lazy-load nut.js only on Windows to inject input
function ensureNutLoaded() {
  if (!nut) {
    try {
      // Dynamic import to avoid packaging issues when optional
      // eslint-disable-next-line global-require
      nut = require("@nut-tree/nut-js");
      // Improve speed/compat
      nut.keyboard.config.autoDelayMs = 0;
      nut.mouse.config.autoDelayMs = 0;
    } catch (err) {
      console.error("@nut-tree/nut-js not available:", err.message);
      throw new Error("MOUSE_INJECTION_NOT_AVAILABLE");
    }
  }
  return nut;
}

// Maintain last known screen size for relative coords
let primaryDisplaySize = { width: 1920, height: 1080 };
app.whenReady().then(() => {
  try {
    const { screen } = require("electron");
    const primary = screen.getPrimaryDisplay();
    if (primary && primary.workAreaSize) {
      primaryDisplaySize = primary.workAreaSize;
    }
  } catch (_) {}
});

function toScreenPoint(relX, relY) {
  const x = Math.round(relX * primaryDisplaySize.width);
  const y = Math.round(relY * primaryDisplaySize.height);
  return { x, y };
}

ipcMain.handle("input-move", async (event, { x, y }) => {
  const { mouse, Point } = ensureNutLoaded();
  const p = toScreenPoint(x, y);
  await mouse.setPosition(new Point(p.x, p.y));
  return true;
});

ipcMain.handle("input-down", async (event, { button }) => {
  const { mouse, Button } = ensureNutLoaded();
  const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
  await mouse.pressButton(map[button] ?? Button.LEFT);
  return true;
});

ipcMain.handle("input-up", async (event, { button }) => {
  const { mouse, Button } = ensureNutLoaded();
  const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
  await mouse.releaseButton(map[button] ?? Button.LEFT);
  return true;
});

ipcMain.handle("input-dbl", async (event, { button }) => {
  const { mouse, Button } = ensureNutLoaded();
  const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
  const b = map[button] ?? Button.LEFT;
  await mouse.doubleClick(b);
  return true;
});

ipcMain.handle("input-ctx", async () => {
  const { mouse, Button } = ensureNutLoaded();
  await mouse.click(Button.RIGHT);
  return true;
});

ipcMain.handle("input-wheel", async (event, { dx = 0, dy = 0 }) => {
  const { mouse } = ensureNutLoaded();
  // nut-js uses steps, positive is down/right
  if (dx) await mouse.scrollRight(Math.trunc(dx * 50));
  if (dy) await mouse.scrollDown(Math.trunc(dy * 50));
  return true;
});
