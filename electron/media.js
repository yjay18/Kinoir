/* ffmpeg-backed local playback: probe files and transcode/remux to HLS on the fly,
   plus extract embedded text subtitles to WebVTT. Chromium (Electron) can't play MKV
   or HLS natively, so the frontend plays the HLS we produce here via hls.js. */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// The bundled binary is resolved during Electron startup, after this module is
// loaded. Read the environment at execution time so previews and playback use it.
const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
const TEXT_SUB_CODECS = /^(subrip|srt|ass|ssa|mov_text|webvtt|text)$/i;

// key ("id/s/e") -> { dir, proc, done, created, subs }
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.created > SESSION_TTL) {
      try { s.proc?.kill('SIGKILL'); } catch { /* gone */ }
      fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
      sessions.delete(key);
    }
  }
}

function killAllSessions() {
  for (const [, s] of sessions) {
    try { s.proc?.kill('SIGKILL'); } catch { /* gone */ }
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  sessions.clear();
}

/* Probe with `ffmpeg -i` (ffprobe may be absent) and scrape stderr. */
function probe(file) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-i', file]);
    let err = '';
    proc.stderr.on('data', d => (err += d));
    proc.on('error', () => resolve({ ok: false, error: 'ffmpeg not found' }));
    proc.on('close', () => {
      const info = { ok: true, vcodec: '', acodec: '', duration: 0, subs: [] };
      const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (dm) info.duration = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]);
      const re = /Stream #\d+:(\d+)(?:\((\w+)\))?[^:]*: (Video|Audio|Subtitle): (\w+)/g;
      let m;
      while ((m = re.exec(err))) {
        const [, idx, lang, kind, codec] = m;
        if (kind === 'Video' && !info.vcodec) info.vcodec = codec;
        else if (kind === 'Audio' && !info.acodec) info.acodec = codec;
        else if (kind === 'Subtitle' && TEXT_SUB_CODECS.test(codec))
          info.subs.push({ index: +idx, lang: lang || `track ${idx}`, codec });
      }
      resolve(info);
    });
  });
}

function waitForFile(file, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      fs.stat(file, (err, st) => {
        if (!err && st.size > 0) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error('timeout waiting for ' + path.basename(file)));
        setTimeout(poll, 120);
      });
    })();
  });
}

/* Start (or reuse) an HLS transcode session for a file. Video is copied when it's
   already H.264, otherwise hardware-encoded (VideoToolbox). Audio is always AAC
   stereo (AC3/DTS/E-AC3 don't play in the browser). */
async function ensureHls(key, file, info) {
  const existing = sessions.get(key);
  if (existing) {
    await waitForFile(path.join(existing.dir, 'index.m3u8'), 20000).catch(() => {});
    return existing;
  }
  sweep();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kinoir-hls-'));
  const copyVideo = /^h264$/i.test(info.vcodec || '');
  const vArgs = copyVideo
    ? ['-c:v', 'copy']
    : ['-c:v', 'h264_videotoolbox', '-b:v', '6M', '-tag:v', 'avc1'];
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-map', '0:v:0', '-map', '0:a:0?',
    ...vArgs,
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(dir, 'seg_%04d.m4s'),
    path.join(dir, 'index.m3u8')
  ];
  const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const sess = { dir, proc, done: false, created: Date.now(), stderr: '' };
  proc.stderr.on('data', d => { sess.stderr += d; });
  proc.on('close', () => { sess.done = true; });
  sessions.set(key, sess);
  try {
    await waitForFile(path.join(dir, 'index.m3u8'), 20000);
  } catch (e) {
    sessions.delete(key);
    try { proc.kill('SIGKILL'); } catch { /* gone */ }
    throw new Error(sess.stderr.split('\n').filter(Boolean).pop() || e.message);
  }
  return sess;
}

/* Extract one embedded text subtitle track to WebVTT (cached in the session dir). */
async function subtitleVtt(key, file, subIndex) {
  const sess = sessions.get(key);
  const dir = sess ? sess.dir : await fsp.mkdtemp(path.join(os.tmpdir(), 'kinoir-sub-'));
  const out = path.join(dir, `sub_${subIndex}.vtt`);
  try { const st = await fsp.stat(out); if (st.size > 0) return out; } catch { /* build it */ }
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-map', `0:${subIndex}`, '-c:s', 'webvtt', out]);
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('subtitle extract failed')));
  });
  return out;
}

module.exports = { probe, ensureHls, subtitleVtt, killAllSessions, sessions };
