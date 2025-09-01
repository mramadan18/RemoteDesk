const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
} = require("electron");
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
