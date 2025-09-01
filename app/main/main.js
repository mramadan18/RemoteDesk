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
const { execFile } = require("child_process");
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
      // Leave nut undefined to fall back to PowerShell injector
    }
  }
  return nut;
}

// Maintain last known screen size for relative coords
let primaryDisplaySize = { width: 1920, height: 1080 };
app.whenReady().then(() => {
  try {
    const { screen } = require("electron");
    const update = () => {
      const primary = screen.getPrimaryDisplay();
      if (primary && primary.bounds) {
        primaryDisplaySize = {
          width: primary.bounds.width,
          height: primary.bounds.height,
        };
      } else if (primary && primary.size) {
        primaryDisplaySize = {
          width: primary.size.width,
          height: primary.size.height,
        };
      } else if (primary && primary.workAreaSize) {
        primaryDisplaySize = primary.workAreaSize;
      }
    };
    update();
    screen.on("display-metrics-changed", update);
  } catch (_) {}
});

function toScreenPoint(relX, relY) {
  const x = Math.round(relX * primaryDisplaySize.width);
  const y = Math.round(relY * primaryDisplaySize.height);
  return { x, y };
}

ipcMain.handle("input-move", async (event, { x, y }) => {
  const loaded = ensureNutLoaded();
  const p = toScreenPoint(x, y);
  if (loaded) {
    const { mouse, Point } = loaded;
    await mouse.setPosition(new Point(p.x, p.y));
    return true;
  }
  await psMove(p.x, p.y);
  return true;
});

ipcMain.handle("input-down", async (event, { button, x, y }) => {
  const loaded = ensureNutLoaded();
  if (typeof x === "number" && typeof y === "number") {
    const p = toScreenPoint(x, y);
    if (loaded) {
      const { mouse, Point } = loaded;
      await mouse.setPosition(new Point(p.x, p.y));
    } else {
      await psMove(p.x, p.y);
    }
  }
  if (loaded) {
    const { mouse, Button } = loaded;
    const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
    await mouse.pressButton(map[button] ?? Button.LEFT);
  } else {
    await psClick(button ?? 0, true);
  }
  return true;
});

ipcMain.handle("input-up", async (event, { button, x, y }) => {
  const loaded = ensureNutLoaded();
  if (typeof x === "number" && typeof y === "number") {
    const p = toScreenPoint(x, y);
    if (loaded) {
      const { mouse, Point } = loaded;
      await mouse.setPosition(new Point(p.x, p.y));
    } else {
      await psMove(p.x, p.y);
    }
  }
  if (loaded) {
    const { mouse, Button } = loaded;
    const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
    await mouse.releaseButton(map[button] ?? Button.LEFT);
  } else {
    // No-op for release in PS fallback
  }
  return true;
});

ipcMain.handle("input-dbl", async (event, { button, x, y }) => {
  const loaded = ensureNutLoaded();
  if (typeof x === "number" && typeof y === "number") {
    const p = toScreenPoint(x, y);
    if (loaded) {
      const { mouse, Point } = loaded;
      await mouse.setPosition(new Point(p.x, p.y));
    } else {
      await psMove(p.x, p.y);
    }
  }
  if (loaded) {
    const { mouse, Button } = loaded;
    const map = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };
    const b = map[button] ?? Button.LEFT;
    await mouse.doubleClick(b);
  } else {
    await psDoubleClick();
  }
  return true;
});

ipcMain.handle("input-ctx", async (event, { x, y }) => {
  const loaded = ensureNutLoaded();
  if (typeof x === "number" && typeof y === "number") {
    const p = toScreenPoint(x, y);
    if (loaded) {
      const { mouse, Point } = loaded;
      await mouse.setPosition(new Point(p.x, p.y));
    } else {
      await psMove(p.x, p.y);
    }
  }
  if (loaded) {
    const { mouse, Button } = loaded;
    await mouse.click(Button.RIGHT);
  } else {
    await psRightClick();
  }
  return true;
});

ipcMain.handle("input-wheel", async (event, { dx = 0, dy = 0 }) => {
  const loaded = ensureNutLoaded();
  if (loaded) {
    const { mouse } = loaded;
    if (dx) await mouse.scrollRight(Math.trunc(dx * 50));
    if (dy) await mouse.scrollDown(Math.trunc(dy * 50));
  } else {
    await psScroll(dx, dy);
  }
  return true;
});

// Simple PowerShell-based fallback using .NET SendInput
function execPS(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function psMove(x, y) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`;
  await execPS(script);
}

async function psClick(button) {
  // 0 left, 1 middle, 2 right
  const btn = button === 2 ? "right" : button === 1 ? "middle" : "left";
  const script = `Add-Type -AssemblyName System.Windows.Forms; $sig=@'
using System;using System.Runtime.InteropServices;public class I{[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags,int dx,int dy,int cButtons,int dwExtraInfo);} 
'@; Add-Type $sig; if ('${btn}' -eq 'right'){[I]::mouse_event(0x0008,0,0,0,0);Start-Sleep -Milliseconds 10;[I]::mouse_event(0x0010,0,0,0,0)} elseif ('${btn}' -eq 'middle'){[I]::mouse_event(0x0020,0,0,0,0);Start-Sleep -Milliseconds 10;[I]::mouse_event(0x0040,0,0,0,0)} else {[I]::mouse_event(0x0002,0,0,0,0);Start-Sleep -Milliseconds 10;[I]::mouse_event(0x0004,0,0,0,0)}`;
  await execPS(script);
}

async function psRightClick() {
  await psClick(2);
}

async function psDoubleClick() {
  const script = `Add-Type -AssemblyName System.Windows.Forms; $sig=@'
using System;using System.Runtime.InteropServices;public class I{[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags,int dx,int dy,int cButtons,int dwExtraInfo);} 
'@; Add-Type $sig; foreach($i in 1..2){[I]::mouse_event(0x0002,0,0,0,0);Start-Sleep -Milliseconds 50;[I]::mouse_event(0x0004,0,0,0,0);Start-Sleep -Milliseconds 50}`;
  await execPS(script);
}

async function psScroll(dx, dy) {
  const vertical = Math.trunc((dy || 0) * 100);
  const horizontal = Math.trunc((dx || 0) * 100);
  const script = `Add-Type -AssemblyName System.Windows.Forms; $sig=@'
using System;using System.Runtime.InteropServices;public class I{[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags,int dx,int dy,int cButtons,int dwExtraInfo);} 
'@; Add-Type $sig; if (${vertical} -ne 0){[I]::mouse_event(0x0800,0,0,${vertical},0)}; if (${horizontal} -ne 0){[I]::mouse_event(0x1000,0,0,${horizontal},0)}`;
  await execPS(script);
}
