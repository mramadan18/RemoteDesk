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
  // Mouse control API
  mouse: {
    move: (x, y) => ipcRenderer.invoke("mouse-move", x, y),
    click: (button, double) =>
      ipcRenderer.invoke("mouse-click", button, double),
    toggle: (button, down) => ipcRenderer.invoke("mouse-toggle", button, down),
    scroll: (x, y) => ipcRenderer.invoke("mouse-scroll", x, y),
  },
  getScreenSize: () => ipcRenderer.invoke("get-screen-size"),
});
