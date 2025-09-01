const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getUserId: () => ipcRenderer.invoke("get-user-id"),
  onConnectionRequest: (callback) =>
    ipcRenderer.on("connection-request", callback),
  onConnectionEstablished: (callback) =>
    ipcRenderer.on("connection-established", callback),
  removeAllListeners: (event) => ipcRenderer.removeAllListeners(event),
});
