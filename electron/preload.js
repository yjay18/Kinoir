/* Exposes a tiny, safe bridge to the renderer for native file/folder pickers.
   contextIsolation is on, so the frontend only sees these explicit methods. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkflix', {
  isElectron: true,
  pickVideoFile: (title) => ipcRenderer.invoke('pick-video-file', { title }),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  playNative: (path, title, playlist, pip) => ipcRenderer.invoke('play-native', { path, title, playlist, pip }),
  openExternalFile: (path) => ipcRenderer.invoke('open-external-file', { path }),
  buildPreviewFromFile: (id, path) => ipcRenderer.invoke('build-preview-from-file', { id, path }),
  getComponentStatus: () => ipcRenderer.invoke('get-component-status'),
  startOllama: () => ipcRenderer.invoke('start-ollama'),
  openComponentPage: (component) => ipcRenderer.invoke('open-component-page', component)
});
