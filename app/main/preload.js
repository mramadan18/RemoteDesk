const { contextBridge, ipcRenderer, clipboard } = require('electron');
const fs = require('fs');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: (opts) => ipcRenderer.invoke('desktop-capturer:get-sources', opts),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  saveFileDialog: (name) => ipcRenderer.invoke('dialog:save-file', name),
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text) => clipboard.writeText(text || ''),
  readClipboardImage: () => {
    const img = clipboard.readImage();
    return img && !img.isEmpty() ? img.toDataURL() : null;
  },
  writeClipboardImageFromDataUrl: (dataUrl) => {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(img);
      return true;
    } catch (_) {
      return false;
    }
  },
  readFile: (filePath) => fs.readFileSync(filePath),
  writeFile: (filePath, buffer) => fs.writeFileSync(filePath, buffer)
});


