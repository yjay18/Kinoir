/* Hover teaser previews: stitch a few short segments of a local file into a tiny,
   low-bitrate MP4 (H.264/AAC, hardware-encoded via VideoToolbox where possible)
   and cache it in the shareable library folder. A separate JSONL
   manifest maps title ids to preview files; watch history is never involved. */

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const media = require('./media');

const SEGMENTS = 4;
const SEG_SECONDS = 2.5;
const WIDTH = 360;           // popup-sized; do not encode pixels we never display
const PREVIEW_VERSION = 2;   // v2 keeps source audio when one is available

const building = new Map();  // id -> in-flight promise (dedup concurrent builds)
let buildTail = Promise.resolve(); // serialize ffmpeg work across different titles

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => (err += d));
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve()
      : reject(new Error(err.split('\n').filter(Boolean).pop() || `ffmpeg exit ${code}`)));
  });
}

function previewKey(id) {
  return path.posix.join('previews', path.basename(String(id)) + '.mp4');
}

function previewPath(dataRoot, id) {
  // ids are app-generated (alnum), but basename() guards against anything odd
  return path.join(dataRoot, 'library', previewKey(id));
}

async function recordPreview(dataRoot, id) {
  const dir = path.join(dataRoot, 'library');
  const target = path.join(dir, 'previews.jsonl');
  await fsp.mkdir(dir, { recursive: true });
  let entries = [];
  try {
    entries = (await fsp.readFile(target, 'utf8')).split(/\r?\n/)
      .filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry?.id !== id);
  } catch { /* first preview or a malformed legacy manifest */ }
  entries.push({ id, file: previewKey(id), version: PREVIEW_VERSION });
  const tmp = path.join(dir, `.previews.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  await fsp.rename(tmp, target);
}

async function hasPreview(dataRoot, id) {
  try { return (await fsp.stat(previewPath(dataRoot, id))).size > 0; }
  catch { return false; }
}

async function buildPreview(dataRoot, id, file) {
  const out = previewPath(dataRoot, id);
  let info = null;
  if (await hasPreview(dataRoot, id)) {
    const cached = await media.probe(out);
    if (cached?.acodec) {
      await recordPreview(dataRoot, id);
      return out;
    }
    // Old previews were deliberately silent. Keep one only when its source is
    // genuinely video-only; otherwise fall through and replace it with v2.
    info = await media.probe(file);
    if (!info?.acodec) {
      await recordPreview(dataRoot, id);
      return out;
    }
  }
  if (building.has(id)) return building.get(id);

  const job = buildTail.then(async () => {
    // Electron resolves its bundled ffmpeg after modules load, so look this up
    // at build time rather than capturing the system fallback at import time.
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    info ||= await media.probe(file);
    const dur = info && info.duration || 0;
    if (dur < 30) throw new Error('file too short for a teaser');

    // segments spread across 8%..85% of the runtime, with a little jitter
    const lo = dur * 0.08, hi = dur * 0.85;
    const ts = Array.from({ length: SEGMENTS }, (_, i) =>
      lo + ((hi - lo) * (i + 0.2 + Math.random() * 0.6)) / SEGMENTS);

    const inputs = [];
    for (const t of ts) inputs.push('-ss', t.toFixed(2), '-t', String(SEG_SECONDS), '-i', file);
    const hasAudio = Boolean(info.acodec);
    const prepared = ts.map((_, i) => {
      const video = `[${i}:v:0]setpts=PTS-STARTPTS[v${i}]`;
      const audio = hasAudio
        ? `;[${i}:a:0]aresample=48000,asetpts=PTS-STARTPTS[a${i}]`
        : '';
      return video + audio;
    }).join(';');
    const links = ts.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('');
    const filter = `${prepared};${links}concat=n=${SEGMENTS}:v=1:a=${hasAudio ? 1 : 0}` +
      `${hasAudio ? '[v][a]' : '[v]'};[v]scale=${WIDTH}:-2,fps=20[vout]` +
      (hasAudio ? ';[a]aresample=48000[aout]' : '');

    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = out + '.tmp.mp4';
    const argsFor = codec => ['-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', filter, '-map', '[vout]',
      ...(hasAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '96k'] : ['-an']), ...codec,
      '-movflags', '+faststart', '-y', tmp];
    try {
      await run(ffmpeg, argsFor(['-c:v', 'h264_videotoolbox', '-b:v', '400k']));
    } catch {   // no VideoToolbox (or it rejected the source) — software fallback
      await run(ffmpeg, argsFor(['-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast']));
    }
    await fsp.rename(tmp, out);
    await recordPreview(dataRoot, id);
    return out;
  }).finally(() => building.delete(id));
  building.set(id, job);
  buildTail = job.catch(() => {});
  return job;
}

module.exports = { buildPreview, hasPreview, previewKey, previewPath };
