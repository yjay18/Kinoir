/* Exposes a tiny, safe bridge to the renderer for native file/folder pickers.
   contextIsolation is on, so the frontend only sees these explicit methods. */
const { contextBridge, ipcRenderer } = require('electron');

const kinoir = {
  isElectron: true,
  pickVideoFile: (title) => ipcRenderer.invoke('pick-video-file', { title }),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  playNative: (path, title, playlist, pip) => ipcRenderer.invoke('play-native', { path, title, playlist, pip }),
  openExternalFile: (path) => ipcRenderer.invoke('open-external-file', { path }),
  buildPreviewFromFile: (id, path) => ipcRenderer.invoke('build-preview-from-file', { id, path }),
  getComponentStatus: () => ipcRenderer.invoke('get-component-status'),
  startOllama: () => ipcRenderer.invoke('start-ollama'),
  pullOllamaModel: (model) => ipcRenderer.invoke('pull-ollama-model', model),
  openComponentPage: (component) => ipcRenderer.invoke('open-component-page', component),
  getAirStatus: () => ipcRenderer.invoke('get-air-status'),
  setAirEnabled: (enabled) => ipcRenderer.invoke('set-air-enabled', Boolean(enabled)),
  getSecretStatus: () => ipcRenderer.invoke('get-secret-status'),
  setBraveKey: (key) => ipcRenderer.invoke('set-brave-key', key),
  searchBrave: (query) => ipcRenderer.invoke('brave-search', query),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openReleasePage: (url) => ipcRenderer.invoke('open-release-page', url)
};

contextBridge.exposeInMainWorld('kinoir', kinoir);
// Compatibility alias for extensions or cached renderer code from pre-rename builds.
contextBridge.exposeInMainWorld('linkflix', kinoir);
