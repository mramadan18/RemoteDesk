const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  clipboard,
} = require("electron");
const { exec } = require("child_process");
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

// Mouse control handlers using PowerShell
function executePowerShellMouseCommand(action, params = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../../mouse-control.ps1");
    let command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -action ${action}`;

    // Add parameters based on action
    switch (action) {
      case "move":
        command += ` -x ${params.x} -y ${params.y}`;
        break;
      case "click":
        command += ` -button ${params.button}`;
        if (params.double) command += " -double";
        break;
      case "toggle":
        command += ` -button ${params.button}`;
        break;
      case "scroll":
        command += ` -x ${params.x} -y ${params.y}`;
        break;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`PowerShell error: ${error}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`PowerShell stderr: ${stderr}`);
      }
      resolve(stdout.trim());
    });
  });
}

ipcMain.handle("mouse-move", async (event, x, y) => {
  try {
    await executePowerShellMouseCommand("move", { x, y });
    return true;
  } catch (error) {
    console.error("Error moving mouse:", error);
    throw error;
  }
});

ipcMain.handle(
  "mouse-click",
  async (event, button = "left", double = false) => {
    try {
      await executePowerShellMouseCommand("click", { button, double });
      return true;
    } catch (error) {
      console.error("Error clicking mouse:", error);
      throw error;
    }
  }
);

ipcMain.handle("mouse-toggle", async (event, button = "left", down) => {
  try {
    await executePowerShellMouseCommand("toggle", { button });
    return true;
  } catch (error) {
    console.error("Error toggling mouse:", error);
    throw error;
  }
});

ipcMain.handle("mouse-scroll", async (event, x, y) => {
  try {
    await executePowerShellMouseCommand("scroll", { x, y });
    return true;
  } catch (error) {
    console.error("Error scrolling mouse:", error);
    throw error;
  }
});

ipcMain.handle("get-screen-size", async () => {
  try {
    const result = await executePowerShellMouseCommand("screensize");
    if (result) {
      return JSON.parse(result);
    }
    // Fallback to Electron's screen API
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
    };
  } catch (error) {
    console.error("Error getting screen size:", error);
    // Fallback to Electron's screen API
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
    };
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
