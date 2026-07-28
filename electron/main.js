/* Kinoir — Electron main process (Mac).
   Starts the internal HTTP backend, then opens a native window pointed at it.
   External http(s) links (Google Drive) open in the user's default browser. */

const { app, BrowserWindow, shell, Menu, ipcMain, dialog, safeStorage } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const media = require('./media');
const nativeplay = require('./nativeplay');
const previews = require('./previews');
const subtitles = require('./subtitles');

// Keep the development menu and user-data location branded too; packaged builds
// also receive this name from productName in package.json.
app.setName('Kinoir');

const STATIC_ROOT = path.join(__dirname, '..');   // app code: index.html, css/, js/
// Writable data (library.json, watch.json, Media/). In the packaged app the bundle is
// read-only, so data lives in a visible ~/Movies/Kinoir folder; in dev it's the project
// root. Existing installs keep using ~/Movies/Linkflix in place, without moving or
// rewriting the user's library.
const preferredDataRoot = path.join(app.getPath('videos'), 'Kinoir');
const legacyDataRoot = path.join(app.getPath('videos'), 'Linkflix');
const packagedDataRoot = !fs.existsSync(preferredDataRoot) && fs.existsSync(legacyDataRoot)
  ? legacyDataRoot : preferredDataRoot;
const DATA_ROOT = process.env.KINOIR_DATA_ROOT || process.env.LINKFLIX_DATA_ROOT
  ? path.resolve(process.env.KINOIR_DATA_ROOT || process.env.LINKFLIX_DATA_ROOT)
  : (app.isPackaged ? packagedDataRoot : STATIC_ROOT);
// Optional runtimes and models live outside the application bundle so updates stay
// small and never remove packs the user chose to install.
const userDataRoot = app.getPath('userData');
const legacyUserDataRoot = path.join(path.dirname(userDataRoot), 'Linkflix');
const preferredPacksRoot = path.join(userDataRoot, 'packs');
const legacyPacksRoot = path.join(legacyUserDataRoot, 'packs');
const PACKS_ROOT = !fs.existsSync(preferredPacksRoot) && fs.existsSync(legacyPacksRoot)
  ? legacyPacksRoot : preferredPacksRoot;
const preferredPrefsPath = path.join(userDataRoot, 'preferences.json');
const legacyPrefsPath = path.join(legacyUserDataRoot, 'preferences.json');
const APP_PREFS_PATH = !fs.existsSync(preferredPrefsPath) && fs.existsSync(legacyPrefsPath)
  ? legacyPrefsPath : preferredPrefsPath;
const approvedVideoPaths = new Set();

function loadMainPreferences() {
  try { return JSON.parse(fs.readFileSync(APP_PREFS_PATH, 'utf8')); }
  catch { return {}; }
}

function saveMainPreferences(prefs) {
  try {
    fs.mkdirSync(path.dirname(APP_PREFS_PATH), { recursive: true });
    const tmp = `${APP_PREFS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, APP_PREFS_PATH);
  } catch { /* the session still works even if preferences cannot persist */ }
}

function readBraveKey() {
  try {
    if (!mainPreferences.braveKeyEncrypted || !safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(mainPreferences.braveKeyEncrypted, 'base64'));
  } catch { return ''; }
}

function storeBraveKey(value) {
  const key = String(value || '').trim();
  if (!key) delete mainPreferences.braveKeyEncrypted;
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage is unavailable');
    mainPreferences.braveKeyEncrypted = safeStorage.encryptString(key).toString('base64');
  }
  saveMainPreferences(mainPreferences);
}

const mainPreferences = loadMainPreferences();
const serverRuntime = {
  packsRoot: PACKS_ROOT,
  resourcesDir: process.resourcesPath,
  air: {
    enabled: Boolean(mainPreferences.airEnabled),
    token: crypto.randomBytes(24).toString('base64url')
  }
};

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
  if (r.canceled) return null;
  const selected = path.resolve(r.filePaths[0]);
  approvedVideoPaths.add(selected);
  return selected;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a media folder',
    properties: ['openDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});

// Native playback of a local file (mpv / IINA / VLC / system), plays MKV/AVI/anything.
async function isApprovedLibraryVideo(fp) {
  if (!fp || !path.isAbsolute(fp)) return false;
  const resolved = path.resolve(fp);
  if (approvedVideoPaths.has(resolved)) return true;
  try {
    const library = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'library', 'library.json'), 'utf8')).library || [];
    return library.some(item => item.localPath && path.resolve(item.localPath) === resolved ||
      (item.seasons || []).some(season => (season.episodes || []).some(episode =>
        episode.localPath && path.resolve(episode.localPath) === resolved)));
  } catch { return false; }
}

ipcMain.handle('play-native', async (_e, { path: fp, title, playlist, pip } = {}) => {
  try {
    if (!await isApprovedLibraryVideo(fp)) throw new Error('file is not part of the saved library');
    const safePlaylist = [];
    for (const entry of Array.isArray(playlist) ? playlist : [])
      if (await isApprovedLibraryVideo(entry)) safePlaylist.push(entry);
    return { ok: true, player: nativeplay.playNative(fp, process.resourcesPath, PACKS_ROOT, title, safePlaylist, pip) };
  }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Option 3: open in the user's default app for that file.
ipcMain.handle('open-external-file', async (_e, { path: fp } = {}) => {
  try {
    if (!await isApprovedLibraryVideo(fp)) throw new Error('file is not part of the saved library');
    nativeplay.openExternal(fp, process.resourcesPath, PACKS_ROOT);
    return { ok: true };
  }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Finder is the trusted path-selection surface for a custom teaser source.
ipcMain.handle('build-preview-from-file', async (_e, { id, path: fp } = {}) => {
  try {
    if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('invalid title id');
    if (!await isApprovedLibraryVideo(fp)) throw new Error('choose this video through Kinoir first');
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
      Number(process.env.KINOIR_PORT || process.env.LINKFLIX_PORT) || 4174,
      DATA_ROOT,
      serverRuntime
    );
    console.log(`[kinoir] app=${STATIC_ROOT} data=${DATA_ROOT} on http://127.0.0.1:${serverInfo.port}`);
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#05060b',
    title: 'Kinoir',
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
    console.log('[kinoir] using the Ollama service already running on 127.0.0.1:11434');
    return true;
  }

  const found = findOllamaBinary();
  if (!found) {
    console.log('[kinoir] Ollama is optional and is not installed');
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
      console.error(`[kinoir] failed to start Ollama: ${err.message || err}`);
    });
    ollamaProcess.on('exit', (code, signal) => {
      if (code && code !== 0)
        console.error(`[kinoir] Ollama exited with code ${code}${signal ? ` (${signal})` : ''}; log: ${ollamaLogPath}`);
      ollamaProcess = null;
    });

    const ready = await waitForOllama();
    if (ready) console.log(`[kinoir] Ollama ready via ${ollamaBin}`);
    else console.error(`[kinoir] Ollama did not become ready; log: ${ollamaLogPath}`);
    return ready;
  } catch (err) {
    console.error(`[kinoir] could not launch Ollama: ${err.message || err}`);
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
      detail: ollamaIsReady ? 'Ready for Concierge' : (ollama ? 'Installed; Kinoir can start it' : 'Optional local AI')
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
ipcMain.handle('pull-ollama-model', async (_event, model) => {
  const name = String(model || '').trim();
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(name)) return { ok: false, error: 'Invalid model name' };
  if (!await startOllama()) return { ok: false, error: 'Ollama is not available' };
  const found = findOllamaBinary();
  if (!found) return { ok: false, error: 'Ollama is not installed' };
  return new Promise(resolve => {
    const child = spawn(found.bin, ['pull', name], {
      cwd: path.dirname(found.bin),
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let errorText = '';
    child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-1000); });
    child.on('error', error => resolve({ ok: false, error: String(error.message || error) }));
    child.on('exit', code => resolve(code === 0
      ? { ok: true }
      : { ok: false, error: errorText.trim() || `Ollama exited with code ${code}` }));
  });
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

function networkAddress() {
  const interfaces = require('os').networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces))
    for (const iface of list || [])
      if (iface.family === 'IPv4' && !iface.internal)
        candidates.push({ name, address: iface.address });
  const isPrivate = address => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(address);
  candidates.sort((a, b) => (isPrivate(b.address) - isPrivate(a.address)) ||
    (/^en/.test(b.name) - /^en/.test(a.name)));
  return candidates[0]?.address || '127.0.0.1';
}

function airStatus() {
  const ip = networkAddress();
  const port = serverInfo?.port || Number(process.env.KINOIR_PORT || process.env.LINKFLIX_PORT) || 4174;
  const baseUrl = ip === '127.0.0.1' ? '' : `http://${ip}:${port}`;
  return {
    enabled: serverRuntime.air.enabled,
    available: Boolean(baseUrl),
    url: baseUrl,
    pairUrl: serverRuntime.air.enabled && baseUrl
      ? `${baseUrl}/pair/${serverRuntime.air.token}` : ''
  };
}

ipcMain.handle('get-air-status', () => airStatus());
ipcMain.handle('set-air-enabled', (_event, enabled) => {
  const next = Boolean(enabled);
  if (next && !serverRuntime.air.enabled)
    serverRuntime.air.token = crypto.randomBytes(24).toString('base64url');
  serverRuntime.air.enabled = next;
  mainPreferences.airEnabled = next;
  saveMainPreferences(mainPreferences);
  return airStatus();
});

ipcMain.handle('get-secret-status', () => ({ braveKey: Boolean(readBraveKey()) }));
ipcMain.handle('set-brave-key', (_event, value) => {
  try { storeBraveKey(value); return { ok: true, configured: Boolean(readBraveKey()) }; }
  catch (error) { return { ok: false, error: String(error.message || error) }; }
});
ipcMain.handle('brave-search', async (_event, query) => {
  const key = readBraveKey();
  const q = String(query || '').trim().slice(0, 500);
  if (!key || !q) return { ok: false, results: [], error: 'Brave Search is not configured' };
  try {
    const response = await fetch('https://api.search.brave.com/res/v1/web/search' +
      `?q=${encodeURIComponent(q)}&count=5`, {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
      });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { ok: true, results: (data.web?.results || []).slice(0, 5).map(result => ({
      title: String(result.title || '').slice(0, 300),
      description: String(result.description || '').slice(0, 1000),
      url: String(result.url || '').slice(0, 2000)
    })) };
  } catch (error) {
    return { ok: false, results: [], error: String(error.message || error) };
  }
});

function versionParts(value) {
  return String(value || '').replace(/^v/, '').split(/[.-]/).slice(0, 3)
    .map(part => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const now = versionParts(current);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i] > now[i];
  }
  return false;
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  try {
    const response = await fetch('https://api.github.com/repos/yjay18/Kinoir/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Kinoir/${currentVersion}` }
    });
    if (response.status === 404) return { ok: true, currentVersion, updateAvailable: false, noReleases: true };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const release = await response.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    const url = /^https:\/\/github\.com\/yjay18\/Kinoir\/releases\//.test(release.html_url || '')
      ? release.html_url : 'https://github.com/yjay18/Kinoir/releases/latest';
    return { ok: true, currentVersion, latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion), url };
  } catch (error) {
    return { ok: false, currentVersion, error: String(error.message || error) };
  }
});
ipcMain.handle('open-release-page', async (_event, url) => {
  const target = /^https:\/\/github\.com\/yjay18\/Kinoir\/releases(?:\/|$)/.test(String(url || ''))
    ? String(url) : 'https://github.com/yjay18/Kinoir/releases/latest';
  await shell.openExternal(target);
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
