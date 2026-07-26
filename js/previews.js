/* Hover teaser previews (frontend): a gentle background worker asks the server to
   build a tiny looping clip for every title with a local file. The shareable
   library/previews.jsonl manifest maps title ids to files in library/previews/;
   it is intentionally separate from personal watch.json. */

import { state } from './state.js';
import { esc } from './dom.js';

const ready = new Set();
const failed = new Map();
const failureMessages = new Map();
const files = new Map();
const inflight = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const progressJobs = new Map();
const PREVIEW_VERSION = 2;
let buildTail = Promise.resolve();
let queuedBuilds = 0;
let serviceCheck = null;
let serviceCheckedAt = 0;

export const hasPreview = id => ready.has(id);
export const previewFailure = id => failureMessages.get(id) || '';
const manifestUrl = 'library/previews.jsonl';

export async function previewServiceReady() {
  if (serviceCheck && Date.now() - serviceCheckedAt < 5000) return serviceCheck;
  serviceCheckedAt = Date.now();
  serviceCheck = fetch('/api/preview/status', { cache: 'no-store' })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      return Boolean(response.ok && data.version >= 2);
    }).catch(() => false);
  return serviceCheck;
}

function renderProgress() {
  const jobs = [...progressJobs.values()];
  let el = document.querySelector('#preview-progress');
  if (!jobs.length) { el?.remove(); return; }
  const job = jobs[jobs.length - 1];
  if (!el) {
    el = document.createElement('aside');
    el.id = 'preview-progress';
    el.className = 'preview-progress glass';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const completed = Math.min(job.completed, job.total);
  const ratio = job.total ? Math.max(8, Math.round(((completed + (job.active ? 0.2 : 0)) / job.total) * 100)) : 8;
  el.innerHTML = `<div class="preview-progress-head"><span class="preview-spinner"></span>
      <span>Generating previews</span><span class="preview-progress-count">${completed} / ${job.total}</span></div>
    <div class="preview-progress-title">${esc(job.error ? `Skipped ${job.title}` : job.title)}</div>
    <div class="preview-progress-track"><span style="width:${ratio}%"></span></div>`;
}

function beginProgress(key, total, title) {
  progressJobs.set(key, { total, completed: 0, title, active: true, error: false });
  renderProgress();
}

function updateProgress(key, changes) {
  const job = progressJobs.get(key);
  if (!job) return;
  Object.assign(job, changes);
  renderProgress();
}

function finishProgress(key) {
  progressJobs.delete(key);
  renderProgress();
}

export function beginManualPreviewProgress(id, title) {
  const key = `manual:${id}`;
  beginProgress(key, 1, title);
  return key;
}

export function finishManualPreviewProgress(key, ok) {
  updateProgress(key, { completed: 1, active: false, error: !ok });
  setTimeout(() => finishProgress(key), ok ? 600 : 1800);
}

export async function loadPreviewManifest() {
  try {
    const r = await fetch(manifestUrl, { cache: 'no-store' });
    if (!r.ok) {
      if (r.status === 404) { files.clear(); ready.clear(); }
      return;
    }
    const entries = (await r.text()).split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).filter(entry => /^[\w-]+$/.test(String(entry?.id || '')) &&
      /^previews\/[\w-]+\.mp4$/.test(String(entry?.file || '')) &&
      Number(entry.version) >= PREVIEW_VERSION);
    files.clear();
    ready.clear();
    // The manifest already says which previews exist. Avoid a burst of one HEAD
    // request per title during startup; files are validated only when used.
    for (const entry of entries) {
      files.set(entry.id, entry.file);
      ready.add(entry.id);
    }
  } catch { /* previews are optional; a build can still create them */ }
}

export const previewUrl = id => `/library/${files.get(id) || `previews/${encodeURIComponent(id)}.mp4`}`;

function hasLocalSource(item) {
  return !!(item.localPath ||
    (item.seasons || []).some(s => (s.episodes || []).some(ep => ep.localPath)));
}

export function invalidatePreview(id) {
  ready.delete(id);
  files.delete(id);
  failed.delete(id);
  failureMessages.delete(id);
}

async function ensureOne(item) {
  if (ready.has(item.id)) return true;
  const retryAt = failed.get(item.id);
  if (retryAt && retryAt > Date.now()) return false;
  failed.delete(item.id);
  try {
    if (!await previewServiceReady()) {
      failureMessages.set(item.id, 'restart Linkflix to load the updated preview service');
      failed.set(item.id, Date.now() + 5000);
      return false;
    }
    const r = await fetch('/api/preview/build', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) { ready.add(item.id); failureMessages.delete(item.id); return true; }
    failureMessages.set(item.id, d.error || 'preview could not be generated');
  } catch (err) { failureMessages.set(item.id, String(err.message || err)); }
  // Sources may be saving, mounting, or temporarily unavailable. Retry on the
  // next short sweep instead of permanently hiding the preview.
  failed.set(item.id, Date.now() + 60 * 1000);
  return false;
}

export function ensurePreview(item) {
  if (!item?.id || !hasLocalSource(item)) return Promise.resolve(false);
  if (ready.has(item.id)) return Promise.resolve(true);
  if (inflight.has(item.id)) return inflight.get(item.id);
  queuedBuilds++;
  const tracked = buildTail.then(() => ensureOne(item)).finally(() => {
    queuedBuilds--;
    inflight.delete(item.id);
  });
  buildTail = tracked.catch(() => {});
  inflight.set(item.id, tracked);
  return tracked;
}

export function requestPreview(item, { opportunistic = false } = {}) {
  if (!item?.id || ready.has(item.id)) return Promise.resolve(ready.has(item?.id));
  if (!hasLocalSource(item)) return Promise.resolve(false);
  if (inflight.has(item.id)) return inflight.get(item.id);
  const retryAt = failed.get(item.id);
  if (retryAt && retryAt > Date.now()) return Promise.resolve(false);
  if (opportunistic && queuedBuilds > 0) return Promise.resolve(false);
  const jobKey = `request:${item.id}`;
  beginProgress(jobKey, 1, item.title);
  return ensurePreview(item).then(ok => {
    updateProgress(jobKey, { completed: 1, active: false, error: !ok,
      title: ok ? item.title : `${item.title} — ${previewFailure(item.id)}` });
    setTimeout(() => finishProgress(jobKey), ok ? 500 : 1600);
    return ok;
  });
}

export async function startPreviewWorker() {
  await sleep(250);
  // Warm only the most likely next titles. Everything else is generated on
  // demand when opened/hovered, so startup never creates a library-sized queue.
  const ordered = [];
  const seen = new Set();
  for (const watch of state.watchLog) {
    const item = state.library.find(candidate => candidate.id === watch.itemId);
    if (item && !seen.has(item.id)) { seen.add(item.id); ordered.push(item); }
  }
  for (const item of state.library) {
    if (!seen.has(item.id)) { seen.add(item.id); ordered.push(item); }
  }
  const candidates = ordered
    .filter(item => hasLocalSource(item) && !ready.has(item.id))
    .slice(0, 3);
  if (candidates.length && !await previewServiceReady()) return;
  for (const item of candidates) {
    const jobKey = `startup:${item.id}`;
    beginProgress(jobKey, 1, item.title);
    const ok = await ensurePreview(item);
    updateProgress(jobKey, { completed: 1, active: false, error: !ok,
      title: ok ? item.title : `${item.title} — ${previewFailure(item.id)}` });
    await sleep(ok ? 400 : 1200);
    finishProgress(jobKey);
    await sleep(350);
  }
}
