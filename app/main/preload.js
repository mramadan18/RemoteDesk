const { contextBridge, ipcRenderer, clipboard } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: (opts) =>
    ipcRenderer.invoke("desktop-capturer:get-sources", opts),
  openFileDialog: () => ipcRenderer.invoke("dialog:open-file"),
  saveFileDialog: (name) => ipcRenderer.invoke("dialog:save-file", name),
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text) => clipboard.writeText(text || ""),
  readClipboardImage: () => {
    const img = clipboard.readImage();
    return img && !img.isEmpty() ? img.toDataURL() : null;
  },
  writeClipboardImageFromDataUrl: (dataUrl) => {
    try {
      const { nativeImage } = require("electron");
      const img = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(img);
      return true;
    } catch (_) {
      return false;
    }
  },
  readFile: (filePath) => {
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );
    return ab;
  },
  writeFile: (filePath, data) => {
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
  },
  simulateMouse: (event) => {
    // optional: require('robotjs') if available
    try {
      const robot = require("robotjs");
      if (
        event.type === "move" &&
        typeof event.x === "number" &&
        typeof event.y === "number"
      ) {
        const { width, height } =
          require("electron").screen.getPrimaryDisplay().workAreaSize;
        robot.moveMouse(
          Math.round(event.x * width),
          Math.round(event.y * height)
        );
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
