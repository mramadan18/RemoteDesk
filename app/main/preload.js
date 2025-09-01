const { contextBridge, ipcRenderer, clipboard } = require("electron");

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
  // Clipboard API for secure clipboard access
  clipboard: {
    writeText: (text) => clipboard.writeText(text),
    readText: () => clipboard.readText(),
  },
  // Screen sharing API
  getScreenSourceInfo: (sourceId) =>
    ipcRenderer.invoke("get-screen-source-info", sourceId),
});
