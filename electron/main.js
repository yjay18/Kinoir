/* Linkflix — Electron main process (Mac).
   Starts the internal HTTP backend, then opens a native window pointed at it.
   External http(s) links (Google Drive) open in the user's default browser. */

const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const media = require('./media');
const nativeplay = require('./nativeplay');
const previews = require('./previews');

const STATIC_ROOT = path.join(__dirname, '..');   // app code: index.html, css/, js/
// Writable data (library.json, watch.json, Media/). In the packaged app the bundle is
// read-only, so data lives in a visible ~/Movies/Linkflix folder; in dev it's the project
// root. (Deliberately not ~/Linkflix — on a case-insensitive Mac that collides with the
// ~/linkflix project directory.)
const DATA_ROOT = app.isPackaged ? path.join(app.getPath('videos'), 'Linkflix') : STATIC_ROOT;

function prepareDataDir() {
  try {
    fs.mkdirSync(path.join(DATA_ROOT, 'library'), { recursive: true });
    fs.mkdirSync(path.join(DATA_ROOT, 'Media'), { recursive: true });
  } catch { /* best effort */ }
}

// Bundled ffmpeg (ffmpeg-static) so local playback works without a system install.
function resolveFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p && app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked');
    if (p && fs.existsSync(p)) { fs.chmodSync(p, 0o755); process.env.FFMPEG_PATH = p; }
  } catch { /* fall back to `ffmpeg` on PATH */ }
}

ipcMain.handle('pick-video-file', async (_e, { title } = {}) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose a video file',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'wmv'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a media folder',
    properties: ['openDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});

// Native playback of a local file (mpv / IINA / VLC / system), plays MKV/AVI/anything.
ipcMain.handle('play-native', (_e, { path: fp, title, playlist, pip } = {}) => {
  try { return { ok: true, player: nativeplay.playNative(fp, process.resourcesPath, title, playlist, pip) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Option 3: open in the user's default app for that file.
ipcMain.handle('open-external-file', (_e, { path: fp } = {}) => {
  try { nativeplay.openExternal(fp); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Finder is the trusted path-selection surface for a custom teaser source.
ipcMain.handle('build-preview-from-file', async (_e, { id, path: fp } = {}) => {
  try {
    if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('invalid title id');
    if (!fp || !fs.statSync(fp).isFile()) throw new Error('video file not found');
    await previews.buildPreview(DATA_ROOT, id, fp);
    return { ok: true, preview: previews.previewKey(id) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

let mainWindow = null;
let serverInfo = null;

async function createWindow() {
  if (!serverInfo) {
    serverInfo = await startServer(STATIC_ROOT, Number(process.env.LINKFLIX_PORT) || 4174, DATA_ROOT);
    console.log(`[linkflix] app=${STATIC_ROOT} data=${DATA_ROOT} on http://127.0.0.1:${serverInfo.port}`);
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#05060b',
    title: 'Linkflix',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Google Drive / any external http link → default browser, not a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'deny' };
  });
  // A show/episode "play" navigates to a Drive URL; keep that in the browser too
  // while leaving the app's own localhost navigation intact.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverInfo.port}`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${serverInfo.port}/index.html`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let ollamaProcess = null;

const bundledOllamaPath = app.isPackaged 
  ? path.join(process.resourcesPath, 'models', 'bin', 'ollama-mac', 'ollama')
  : path.join(__dirname, '..', 'models', 'bin', 'ollama-mac', 'ollama');

app.whenReady().then(() => {
  let ollamaBin = 'ollama';
  if (fs.existsSync(bundledOllamaPath)) {
    ollamaBin = bundledOllamaPath;
  }
  
  ollamaProcess = spawn(ollamaBin, ['serve'], { stdio: 'ignore' });
  ollamaProcess.on('error', (err) => {
    if (ollamaBin === 'ollama' && fs.existsSync(bundledOllamaPath)) {
      ollamaProcess = spawn(bundledOllamaPath, ['serve'], { stdio: 'ignore' });
      ollamaProcess.on('error', () => {});
    }
  });
  
  prepareDataDir();
  resolveFfmpeg();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { 
  if (ollamaProcess) { try { ollamaProcess.kill(); } catch {} }
  try { media.killAllSessions(); } catch { /* nothing to clean */ } 
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
