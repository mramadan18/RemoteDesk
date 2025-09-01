const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: (opts) =>
    ipcRenderer.invoke("desktop-capturer:get-sources", opts),

  simulateMouse: (event) => {
    // optional: require('robotjs') if available
    try {
      const robot = require("robotjs");
      if (
        event.type === "move" &&
        typeof event.x === "number" &&
        typeof event.y === "number"
      ) {
        // Use absolute screen coordinates directly (no scaling needed)
        robot.moveMouse(event.x, event.y);
      } else if (event.type === "down" || event.type === "up") {
        robot.mouseToggle(event.type);
      }
      return true;
    } catch (_) {
      return false;
    }
  },
  simulateKey: (event) => {
    try {
      const robot = require("robotjs");
      if (event.type === "down" || event.type === "up") {
        robot.keyToggle(String(event.key).toLowerCase(), event.type);
      }
      return true;
    } catch (_) {
      return false;
    }
  },
});
