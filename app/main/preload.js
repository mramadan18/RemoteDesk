const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getUserId: () => ipcRenderer.invoke("get-user-id"),
  getDesktopCapturerSources: () =>
    ipcRenderer.invoke("get-desktop-capturer-sources"),
  onConnectionRequest: (callback) =>
    ipcRenderer.on("connection-request", callback),
  onConnectionEstablished: (callback) =>
    ipcRenderer.on("connection-established", callback),
  removeAllListeners: (event) => ipcRenderer.removeAllListeners(event),
  // Clipboard API using IPC for secure access
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
    readText: () => ipcRenderer.invoke("clipboard-read-text"),
  },
  // Screen sharing API
  getScreenSourceInfo: (sourceId) =>
    ipcRenderer.invoke("get-screen-source-info", sourceId),
  // Input injection API
  input: {
    move: (x, y) => ipcRenderer.invoke("input-move", { x, y }),
    down: (button) => ipcRenderer.invoke("input-down", { button }),
    up: (button) => ipcRenderer.invoke("input-up", { button }),
    dbl: (button) => ipcRenderer.invoke("input-dbl", { button }),
    ctx: () => ipcRenderer.invoke("input-ctx"),
    wheel: (dx, dy) => ipcRenderer.invoke("input-wheel", { dx, dy }),
  },
});
