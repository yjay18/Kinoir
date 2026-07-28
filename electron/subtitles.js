/* Local AI subtitle generation (offline Whisper). Rips the audio track with ffmpeg,
   transcribes it with whisper.cpp (whisper-cli), and saves a .vtt SIDECAR next to the
   video file — so IINA/mpv auto-load it and the in-app player can serve it. Jobs run
   one at a time with parseable progress. */

const { spawn, execSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const MODEL_SHA256 = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';

const jobs = new Map();   // key "id/s/e" -> { state, pct, error, outPath, startedAt }

function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

function resolveWhisper(resourcesDir, packsRoot) {
  const found = firstExisting([
    process.env.WHISPER_PATH,
    packsRoot && path.join(packsRoot, 'whisper', 'current', 'whisper-cli'),
    resourcesDir && path.join(resourcesDir, 'whisper', 'whisper-cli'),
    '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'
  ]);
  if (found) return found;
  try {
    const p = execSync('which whisper-cli', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* not on PATH */ }
  return null;
}

function resolveModelPath(packsRoot) {
  const spots = [
    process.env.WHISPER_MODEL,
    packsRoot && path.join(packsRoot, 'whisper', 'models', 'ggml-base.bin'),
    path.join(__dirname, '..', 'models', 'whisper', 'ggml-base.bin')
  ];
  return firstExisting(spots);
}

async function resolveModel(packsRoot, onPct) {
  const found = resolveModelPath(packsRoot);
  if (found) return found;
  // Download the optional model outside the app bundle and verify it before use.
  const target = path.join(packsRoot, 'whisper', 'models', 'ggml-base.bin');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const res = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const tmp = target + '.tmp';
  const out = fs.createWriteStream(tmp);
  const hash = createHash('sha256');
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    hash.update(value);
    if (total && onPct) onPct(Math.round((got / total) * 100));
    if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
  }
  await new Promise(r => out.end(r));
  if (hash.digest('hex') !== MODEL_SHA256) {
    await fsp.rm(tmp, { force: true });
    throw new Error('downloaded Whisper model failed its integrity check');
  }
  await fsp.rename(tmp, target);
  return target;
}

/* An existing sidecar (.vtt or .srt) next to the video, if any. */
function sidecarFor(videoPath) {
  const base = videoPath.replace(/\.[^.]+$/, '');
  return firstExisting([base + '.vtt', base + '.srt', base + '.en.vtt', base + '.en.srt']);
}

function run(bin, args, onStderrLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => {
      err += d;
      if (onStderrLine) String(d).split('\n').forEach(l => onStderrLine(l));
    });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve()
      : reject(new Error(err.split('\n').filter(Boolean).pop() || `${path.basename(bin)} exit ${code}`)));
  });
}

function status(key) {
  return jobs.get(key) || { state: 'idle' };
}

/* Kick off (or return the in-flight) generation job for one video file. */
function generate(packsRoot, resourcesDir, key, videoPath) {
  const existing = jobs.get(key);
  if (existing && (existing.state === 'done' || existing.state === 'error' ? false : true)) return existing;

  const job = { state: 'starting', pct: 0, error: null, outPath: null, startedAt: Date.now() };
  jobs.set(key, job);

  (async () => {
    const whisper = resolveWhisper(resourcesDir, packsRoot);
    if (!whisper) throw new Error('Whisper is optional and is not installed. Open Settings → Components to set it up.');

    job.state = 'downloading-model';
    const model = await resolveModel(packsRoot, pct => { job.pct = pct; });

    // 1. rip audio -> 16 kHz mono wav (what whisper.cpp expects)
    job.state = 'extracting-audio'; job.pct = 0;
    const wav = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'kinoir-sub-')), 'audio.wav');
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav]);

    // 2. transcribe -> .vtt next to the video (IINA/mpv auto-load it)
    job.state = 'transcribing'; job.pct = 0;
    const outBase = videoPath.replace(/\.[^.]+$/, '');
    await run(whisper, ['-m', model, '-f', wav, '-l', 'auto', '-ovtt', '-of', outBase, '-pp'],
      line => { const m = line.match(/progress\s*=\s*(\d+)%/); if (m) job.pct = +m[1]; });

    await fsp.rm(path.dirname(wav), { recursive: true, force: true });
    job.outPath = outBase + '.vtt';
    job.state = 'done'; job.pct = 100;
  })().catch(e => {
    job.state = 'error';
    job.error = String(e.message || e);
  });

  return job;
}

/* Sidecar as servable WebVTT: .vtt passes through, .srt converts once into a temp cache. */
const vttCache = new Map();   // srt path -> converted vtt path
async function sidecarVtt(videoPath) {
  const side = sidecarFor(videoPath);
  if (!side) return null;
  if (side.endsWith('.vtt')) return side;
  if (vttCache.has(side) && fs.existsSync(vttCache.get(side))) return vttCache.get(side);
  const out = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'kinoir-vtt-')), 'sub.vtt');
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', side, '-y', out]);
  vttCache.set(side, out);
  return out;
}

module.exports = { generate, status, sidecarFor, sidecarVtt, resolveWhisper, resolveModelPath };
