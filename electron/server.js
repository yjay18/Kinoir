/* Internal HTTP server for the Electron shell.
   Mirrors server.py: serves the static frontend and handles the atomic
   POST /api/save-library autosave. This is the backend that later phases
   (Ollama proxy, ffmpeg/HLS streaming, folder scanning) extend. */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const media = require('./media');
const scanner = require('./scanner');
const previews = require('./previews');
const subtitles = require('./subtitles');

const MEDIA_MIME = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/* GET /api/models — the Ollama models the user has pulled (for the Settings picker). */
async function ollamaModels(res) {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    send(res, 200, JSON.stringify({ models: (d.models || []).map(m => m.name) }),
      { 'Content-Type': 'application/json' });
  } catch (e) {
    send(res, 502, JSON.stringify({ models: [], error: `Ollama not reachable: ${e.message || e}` }),
      { 'Content-Type': 'application/json' });
  }
}

/* POST /api/concierge — proxy a chat to Ollama and stream the NDJSON reply back.
   Keeps everything same-origin (no CORS) and lets us manage the local model. */
async function ollamaConcierge(res, body) {
  let payload;
  try { payload = JSON.parse(body || '{}'); }
  catch { return send(res, 400, JSON.stringify({ error: 'bad JSON' }), { 'Content-Type': 'application/json' }); }
  const model = payload.model || 'llama3.2';
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const temperature = typeof payload.temperature === 'number' ? payload.temperature : 0.4;

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, format: payload.format, options: { temperature } }),
      signal: ac.signal
    });
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: `Ollama not reachable at ${OLLAMA}. Is it running? (${e.message || e})` }),
      { 'Content-Type': 'application/json' });
  }
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return send(res, 502, JSON.stringify({ error: `Ollama error ${upstream.status}: ${t.slice(0, 200)}` }),
      { 'Content-Type': 'application/json' });
  }
  res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  try {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(dec.decode(value, { stream: true }));
    }
  } catch { /* aborted or client disconnected */ }
  res.end();
}

/* Atomic write of library/library.json — identical semantics to server.py:
   write a temp file on the same filesystem, then rename over the target. */
async function saveLibrary(rootDir, payload) {
  const library = payload && payload.library;
  if (!Array.isArray(library)) throw new Error('Expected a library array');
  const dir = path.join(rootDir, 'library');
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'library.json');
  const tmp = path.join(dir, `.library.${process.pid}.${Date.now()}.tmp`);
  const data = JSON.stringify({ library }, null, 2) + '\n';
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, target);
  return path.relative(rootDir, target);
}

function serveStatic(staticRoot, dataRoot, req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  // library.json / watch.json live in the writable data root; everything else is app code
  const base = urlPath.startsWith('/library/') ? dataRoot : staticRoot;
  const filePath = path.normalize(path.join(base, urlPath));
  // path-traversal guard: never serve outside the root
  if (filePath !== base && !filePath.startsWith(base + path.sep))
    return send(res, 403, 'Forbidden');
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* Collect every local file path already linked in the saved library. */
async function knownLocalPaths(rootDir) {
  const set = new Set();
  try {
    const lib = JSON.parse(await fsp.readFile(path.join(rootDir, 'library', 'library.json'), 'utf8')).library || [];
    for (const item of lib) {
      if (item.localPath) set.add(item.localPath);
      for (const s of item.seasons || [])
        for (const ep of s.episodes || []) if (ep.localPath) set.add(ep.localPath);
    }
  } catch { /* no library yet */ }
  return set;
}

/* POST /api/scan { roots:[abs...] } — walk the default Media/ folder plus any
   user folders, return parsed movie/show candidates. */
async function handleScan(rootDir, res, body) {
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch { /* defaults */ }
  const roots = [path.join(rootDir, 'Media'), ...(Array.isArray(payload.roots) ? payload.roots : [])]
    .filter(Boolean);
  const uniq = [...new Set(roots.map(r => path.resolve(r)))];
  const known = await knownLocalPaths(rootDir);
  const result = await scanner.scanRoots(uniq, known);
  send(res, 200, JSON.stringify({ ok: true, roots: uniq, ...result }), { 'Content-Type': 'application/json' });
}

/* First local file for an item: the movie's own file, else the first episode
   that has one (context.md: teasers use the first episode of a series). */
async function firstLocalFile(rootDir, id) {
  let lib;
  try {
    lib = JSON.parse(await fsp.readFile(path.join(rootDir, 'library', 'library.json'), 'utf8')).library || [];
  } catch { return null; }
  const item = lib.find(i => i.id === id);
  if (!item) return null;
  const candidates = [item.localPath,
    ...(item.seasons || []).flatMap(s => (s.episodes || []).map(ep => ep.localPath))];
  for (const p of candidates) {
    if (!p) continue;
    try { if (fs.statSync(p).isFile()) return p; } catch { /* moved/unmounted */ }
  }
  return null;
}

/* Resolve a playable local path from the SAVED library (never from the URL) —
   the path comes from library.json, which the user populated via the picker/scanner. */
async function resolveLocalPath(rootDir, id, s, e) {
  let raw;
  try { raw = await fsp.readFile(path.join(rootDir, 'library', 'library.json'), 'utf8'); }
  catch { return null; }
  let lib;
  try { lib = JSON.parse(raw).library; } catch { return null; }
  const item = (lib || []).find(i => i.id === id);
  if (!item) return null;
  const p = item.type === 'movie'
    ? item.localPath
    : item.seasons?.[s]?.episodes?.[e]?.localPath;
  if (!p) return null;
  try { if (!fs.statSync(p).isFile()) return null; } catch { return null; }
  return p;
}

function serveSessionFile(sess, name, res) {
  const file = path.join(sess.dir, path.basename(name));   // basename blocks traversal
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* Local-playback routes. Returns true if the request was a media route. */
async function handleMedia(rootDir, res, pathname) {
  let m = pathname.match(/^\/probe\/([^/]+)\/(\d+)\/(\d+)$/);
  if (m) {
    const [, id, s, e] = m;
    const file = await resolveLocalPath(rootDir, id, +s, +e);
    if (!file) { send(res, 404, JSON.stringify({ ok: false, error: 'no local file' }), { 'Content-Type': 'application/json' }); return true; }
    const info = await media.probe(file);
    if (info && info.ok && subtitles.sidecarFor(file))     // generated/downloaded sidecar subs
      (info.subs = info.subs || []).push({ index: -1, lang: 'External subtitles', codec: 'sidecar' });
    send(res, 200, JSON.stringify(info), { 'Content-Type': 'application/json' });
    return true;
  }
  m = pathname.match(/^\/hls\/([^/]+)\/(\d+)\/(\d+)\/([\w.]+)$/);
  if (m) {
    const [, id, s, e, name] = m;
    const key = `${id}/${s}/${e}`;
    let sess = media.sessions.get(key);
    if (!sess) {
      const file = await resolveLocalPath(rootDir, id, +s, +e);
      if (!file) { send(res, 404, 'no local file'); return true; }
      sess = await media.ensureHls(key, file, await media.probe(file));
    }
    serveSessionFile(sess, name, res);
    return true;
  }
  m = pathname.match(/^\/subs\/([^/]+)\/(\d+)\/(\d+)\/(-?\d+)\.vtt$/);
  if (m) {
    const [, id, s, e, idx] = m;
    const file = await resolveLocalPath(rootDir, id, +s, +e);
    if (!file) { send(res, 404, 'no local file'); return true; }
    const vtt = +idx < 0
      ? await subtitles.sidecarVtt(file)                   // generated/external sidecar
      : await media.subtitleVtt(`${id}/${s}/${e}`, file, +idx);
    if (!vtt) { send(res, 404, 'no sidecar'); return true; }
    const buf = await fsp.readFile(vtt);
    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }
  return false;
}

function handle(staticRoot, dataRoot, req, res) {
  const pathname = req.url.split('?')[0];
  if (req.method === 'GET' &&
      (pathname.startsWith('/probe/') || pathname.startsWith('/hls/') || pathname.startsWith('/subs/'))) {
    handleMedia(dataRoot, res, pathname)
      .then(done => { if (!done) send(res, 404, 'Not found'); })
      .catch(err => send(res, 500, JSON.stringify({ error: String(err.message || err) }), { 'Content-Type': 'application/json' }));
    return;
  }
  // ---- AI subtitle generation (offline Whisper) ----
  if (req.method === 'POST' && pathname === '/api/subtitles/generate') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { id, s = 0, e = 0 } = JSON.parse(body || '{}');
        if (!id) throw new Error('no id');
        const file = await resolveLocalPath(dataRoot, id, +s, +e);
        if (!file) return send(res, 404, JSON.stringify({ ok: false, error: 'no local file' }),
          { 'Content-Type': 'application/json' });
        const job = subtitles.generate(dataRoot, process.resourcesPath, `${id}/${s}/${e}`, file);
        send(res, 200, JSON.stringify({ ok: true, job: { state: job.state, pct: job.pct } }),
          { 'Content-Type': 'application/json' });
      } catch (err) {
        send(res, 500, JSON.stringify({ ok: false, error: String(err.message || err) }),
          { 'Content-Type': 'application/json' });
      }
    });
    return;
  }
  if (req.method === 'GET') {
    const sm = pathname.match(/^\/api\/subtitles\/status\/([^/]+)\/(\d+)\/(\d+)$/);
    if (sm) {
      const j = subtitles.status(`${sm[1]}/${sm[2]}/${sm[3]}`);
      send(res, 200, JSON.stringify(j), { 'Content-Type': 'application/json' });
      return;
    }
    const lm = pathname.match(/^\/api\/subtitles\/list\/([^/]+)$/);
    if (lm) {
      (async () => {
        let lib;
        try {
          lib = JSON.parse(await fsp.readFile(path.join(dataRoot, 'library', 'library.json'), 'utf8')).library || [];
        } catch { lib = []; }
        const item = lib.find(i => i.id === lm[1]);
        if (!item) return send(res, 404, JSON.stringify({ ok: false }), { 'Content-Type': 'application/json' });
        const rows = [];
        if (item.type === 'movie') {
          if (item.localPath) rows.push({ s: 0, e: 0, title: item.title,
            hasSubs: !!subtitles.sidecarFor(item.localPath),
            job: subtitles.status(`${item.id}/0/0`).state });
        } else {
          (item.seasons || []).forEach((se, si) => (se.episodes || []).forEach((ep, ei) => {
            if (ep.localPath) rows.push({ s: si, e: ei,
              title: `S${si + 1} E${ei + 1} — ${ep.title || 'Episode ' + (ei + 1)}`,
              hasSubs: !!subtitles.sidecarFor(ep.localPath),
              job: subtitles.status(`${item.id}/${si}/${ei}`).state });
          }));
        }
        send(res, 200, JSON.stringify({ ok: true, rows,
          whisper: !!subtitles.resolveWhisper(process.resourcesPath) }),
          { 'Content-Type': 'application/json' });
      })().catch(err => send(res, 500, JSON.stringify({ ok: false, error: String(err.message || err) }),
        { 'Content-Type': 'application/json' }));
      return;
    }
  }
  if (req.method === 'GET' && pathname === '/api/preview/status') {
    send(res, 200, JSON.stringify({ ok: true, version: 2 }),
      { 'Content-Type': 'application/json' });
    return;
  }
  // Legacy preview URL. New previews live in the shareable library folder.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const pm = pathname.match(/^\/preview\/([\w-]+)\.mp4$/);
    if (pm) {
      const file = previews.previewPath(dataRoot, pm[1]);
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return send(res, 404, 'no preview');
        res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'video/mp4',
          'Content-Length': st.size });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      });
      return;
    }
  }
  if (req.method === 'POST' && pathname === '/api/preview/build') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body || '{}');
        if (!id) throw new Error('no id');
        const file = await firstLocalFile(dataRoot, id);
        if (!file) return send(res, 404, JSON.stringify({ ok: false, error: 'no local file' }),
          { 'Content-Type': 'application/json' });
        await previews.buildPreview(dataRoot, id, file);
        send(res, 200, JSON.stringify({ ok: true, ready: true, preview: previews.previewKey(id) }), { 'Content-Type': 'application/json' });
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: String(e.message || e) }),
          { 'Content-Type': 'application/json' });
      }
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/ip') {
    const os = require('os');
    const candidates = [];
    for (const [name, list] of Object.entries(os.networkInterfaces()))
      for (const iface of list || [])
        if (iface.family === 'IPv4' && !iface.internal)
          candidates.push({ name, address: iface.address });
    // prefer real LAN (private-range) addresses on en* over VPN/bridge adapters
    const isPrivate = a => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(a);
    candidates.sort((a, b) =>
      (isPrivate(b.address) - isPrivate(a.address)) ||
      (/^en/.test(b.name) - /^en/.test(a.name)));
    const ip = candidates[0]?.address || '127.0.0.1';
    send(res, 200, JSON.stringify({ ip, port: req.socket.localPort }), { 'Content-Type': 'application/json' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/qr') {
    const url = new URL('http://localhost' + req.url);
    const text = url.searchParams.get('text');
    if (!text) return send(res, 400, 'no text');
    try {
      const qrcode = require('qrcode');
      qrcode.toString(text, { type: 'svg' }, (err, svg) => {
        if (err) return send(res, 500, 'error');
        send(res, 200, svg, { 'Content-Type': 'image/svg+xml' });
      });
    } catch (e) {
      send(res, 500, 'error');
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/models') return ollamaModels(res);
  if (req.method === 'POST' && pathname === '/api/concierge') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => ollamaConcierge(res, body));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/scan') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1 * 1024 * 1024) req.destroy(); });
    req.on('end', () => handleScan(dataRoot, res, body)
      .catch(e => send(res, 500, JSON.stringify({ ok: false, error: String(e.message || e) }), { 'Content-Type': 'application/json' })));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/save-library') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 200 * 1024 * 1024) req.destroy();   // 200 MB guard
    });
    req.on('end', async () => {
      try {
        const rel = await saveLibrary(dataRoot, JSON.parse(body || '{}'));
        send(res, 200, JSON.stringify({ ok: true, path: rel }),
          { 'Content-Type': 'application/json' });
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: String(e.message || e) }),
          { 'Content-Type': 'application/json' });
      }
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(staticRoot, dataRoot, req, res);
  send(res, 405, 'Method not allowed');
}

/* Start on preferredPort, walking forward a few ports if it's taken.
   `dataRoot` (writable: library/, Media/) defaults to staticRoot for dev.
   Resolves { server, port }. */
function startServer(staticRoot, preferredPort = 4174, dataRoot = staticRoot) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(staticRoot, dataRoot, req, res));
    let port = preferredPort;
    const maxPort = preferredPort + 25;
    let settled = false;
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port < maxPort) {
        port += 1;
        server.listen(port, '0.0.0.0');
      } else if (!settled) {
        settled = true;
        reject(err);
      }
    });
    server.listen(port, '0.0.0.0', () => {
      settled = true;
      resolve({ server, port });
    });
  });
}

module.exports = { startServer, saveLibrary };
