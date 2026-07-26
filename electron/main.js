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
const subtitles = require('./subtitles');

const STATIC_ROOT = path.join(__dirname, '..');   // app code: index.html, css/, js/
// Writable data (library.json, watch.json, Media/). In the packaged app the bundle is
// read-only, so data lives in a visible ~/Movies/Linkflix folder; in dev it's the project
// root. (Deliberately not ~/Linkflix — on a case-insensitive Mac that collides with the
// ~/linkflix project directory.)
const DATA_ROOT = process.env.LINKFLIX_DATA_ROOT
  ? path.resolve(process.env.LINKFLIX_DATA_ROOT)
  : (app.isPackaged ? path.join(app.getPath('videos'), 'Linkflix') : STATIC_ROOT);
// Optional runtimes and models live outside the application bundle so updates stay
// small and never remove packs the user chose to install.
const PACKS_ROOT = path.join(app.getPath('userData'), 'packs');

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
  try { return { ok: true, player: nativeplay.playNative(fp, process.resourcesPath, PACKS_ROOT, title, playlist, pip) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Option 3: open in the user's default app for that file.
ipcMain.handle('open-external-file', (_e, { path: fp } = {}) => {
  try { nativeplay.openExternal(fp, process.resourcesPath, PACKS_ROOT); return { ok: true }; }
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
    serverInfo = await startServer(
      STATIC_ROOT,
      Number(process.env.LINKFLIX_PORT) || 4174,
      DATA_ROOT,
      { packsRoot: PACKS_ROOT, resourcesDir: process.resourcesPath }
    );
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
      sandbox: true,
      devTools: !app.isPackaged,
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
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
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
let ollamaLogPath = null;
let ollamaStarting = null;

const OLLAMA_URL = 'http://127.0.0.1:11434';

async function ollamaReady() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForOllama(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ollamaReady()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function findOllamaBinary() {
  const candidates = [
    { bin: path.join(PACKS_ROOT, 'ollama', 'current', 'ollama'), source: 'Managed pack' },
    { bin: '/Applications/Ollama.app/Contents/Resources/ollama', source: 'Ollama app' },
    { bin: '/opt/homebrew/bin/ollama', source: 'Homebrew' },
    { bin: '/usr/local/bin/ollama', source: 'Command line tools' }
  ];
  return candidates.find(({ bin }) => fs.existsSync(bin)) || null;
}

async function startOllama() {
  if (ollamaStarting) return ollamaStarting;
  ollamaStarting = startOllamaOnce();
  try { return await ollamaStarting; }
  finally { ollamaStarting = null; }
}

async function startOllamaOnce() {
  // Reuse a system/user Ollama service if one is already listening.
  if (await ollamaReady()) {
    console.log('[linkflix] using the Ollama service already running on 127.0.0.1:11434');
    return true;
  }

  const found = findOllamaBinary();
  if (!found) {
    console.log('[linkflix] Ollama is optional and is not installed');
    return false;
  }
  const ollamaBin = found.bin;

  try {
    // Packaging preserves the executable bit. A copied app can live on a
    // read-only/translocated volume, so a chmod failure must not block launch.
    try { fs.chmodSync(ollamaBin, 0o755); } catch { /* already executable/read-only bundle */ }
    const logsDir = app.getPath('logs');
    fs.mkdirSync(logsDir, { recursive: true });
    ollamaLogPath = path.join(logsDir, 'ollama.log');
    const logFd = fs.openSync(ollamaLogPath, 'a');
    try {
      ollamaProcess = spawn(ollamaBin, ['serve'], {
        cwd: path.dirname(ollamaBin),
        env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
        stdio: ['ignore', logFd, logFd]
      });
    } finally {
      fs.closeSync(logFd);
    }

    ollamaProcess.on('error', err => {
      console.error(`[linkflix] failed to start Ollama: ${err.message || err}`);
    });
    ollamaProcess.on('exit', (code, signal) => {
      if (code && code !== 0)
        console.error(`[linkflix] Ollama exited with code ${code}${signal ? ` (${signal})` : ''}; log: ${ollamaLogPath}`);
      ollamaProcess = null;
    });

    const ready = await waitForOllama();
    if (ready) console.log(`[linkflix] Ollama ready via ${ollamaBin}`);
    else console.error(`[linkflix] Ollama did not become ready; log: ${ollamaLogPath}`);
    return ready;
  } catch (err) {
    console.error(`[linkflix] could not launch Ollama: ${err.message || err}`);
    return false;
  }
}

function sourceLabel(file, fallback) {
  if (!file) return fallback;
  if (file.startsWith(PACKS_ROOT)) return 'Managed pack';
  if (file.startsWith('/Applications/')) return 'Installed app';
  if (file.startsWith('/opt/homebrew/')) return 'Homebrew';
  return fallback;
}

async function componentStatus() {
  const ollamaIsReady = await ollamaReady();
  const ollama = findOllamaBinary();
  const player = nativeplay.resolvePlayer(process.resourcesPath, PACKS_ROOT);
  const whisperBin = subtitles.resolveWhisper(process.resourcesPath, PACKS_ROOT);
  const whisperModel = subtitles.resolveModelPath(PACKS_ROOT);
  return {
    ollama: {
      state: ollamaIsReady ? 'ready' : (ollama ? (ollamaStarting ? 'starting' : 'installed') : 'missing'),
      source: ollamaIsReady && !ollama ? 'Running service' : (ollama?.source || ''),
      detail: ollamaIsReady ? 'Ready for Concierge' : (ollama ? 'Installed; Linkflix can start it' : 'Optional local AI')
    },
    iina: {
      state: player ? 'ready' : 'missing',
      source: player ? sourceLabel(player.bin, 'Installed player') : '',
      detail: player ? 'Ready for native playback' : 'Optional; in-app playback remains available'
    },
    whisper: {
      state: whisperBin ? 'ready' : 'missing',
      source: whisperBin ? sourceLabel(whisperBin, 'Command line tools') : '',
      detail: whisperBin
        ? (whisperModel ? 'Ready for local subtitles' : 'Model downloads on first use')
        : 'Optional local subtitle generation'
    }
  };
}

ipcMain.handle('get-component-status', () => componentStatus());
ipcMain.handle('start-ollama', async () => {
  const ok = await startOllama();
  return { ok, components: await componentStatus() };
});
ipcMain.handle('open-component-page', async (_event, component) => {
  const pages = {
    ollama: 'https://ollama.com/download/mac',
    iina: 'https://iina.io/download/',
    whisper: 'https://github.com/ggerganov/whisper.cpp#quick-start'
  };
  const url = pages[component];
  if (!url) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(async () => {
  prepareDataDir();
  resolveFfmpeg();
  buildMenu();
  await createWindow();
  // Optional AI should never delay normal app startup.
  void startOllama();
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
