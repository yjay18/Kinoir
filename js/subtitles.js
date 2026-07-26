/* Subtitle generation UI: a "⋯" menu on the title page (home for non-essential
   actions) with "Generate subtitles". Opens a picker listing the title's local
   files (episodes for shows, the film itself for movies); each row can kick off an
   offline Whisper job on the server and shows live progress. The finished .vtt is
   saved next to the video, so IINA/mpv auto-load it and the in-app player serves it. */

import { $, $$, esc, toast } from './dom.js';
import { openAddModal } from './modals.js';
import { state, store, saveLibrary } from './state.js';
import { render } from './views.js';
import {
  beginManualPreviewProgress, finishManualPreviewProgress, loadPreviewManifest,
  previewServiceReady
} from './previews.js';

/* ---------- the ⋯ menu ---------- */
let menuEl = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener('click', onDocClick, true);
}

function onDocClick(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

export function openMoreMenu(anchor, item) {
  if (menuEl) { closeMenu(); return; }
  if (!item) return;
  menuEl = document.createElement('div');
  menuEl.className = 'more-menu glass';
  menuEl.innerHTML = `
    <button data-menu-preview>Generate preview from file…</button>
    <button data-menu-subs>Generate subtitles…</button>
    <button data-menu-edit>Edit</button>
    <button data-menu-delete style="color: #ff8a90;">Delete</button>`;
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.left = Math.min(r.left, innerWidth - 250) + 'px';
  menuEl.style.top = (r.bottom + 8) + 'px';
  menuEl.addEventListener('click', e => {
    if (e.target.closest('[data-menu-preview]')) { closeMenu(); choosePreviewSource(item); }
    else if (e.target.closest('[data-menu-subs]')) { closeMenu(); openSubtitleCenter(item); }
    else if (e.target.closest('[data-menu-edit]')) { closeMenu(); openAddModal(item.id); }
    else if (e.target.closest('[data-menu-delete]')) {
      closeMenu();
      if (confirm(`Delete “${item.title}” from your library?`)) {
        state.library = state.library.filter(i => i.id !== item.id);
        state.watchLog = state.watchLog.filter(w => w.itemId !== item.id);
        saveLibrary(); store.set('watchLog', state.watchLog);
        state.view = { name: 'home' }; render(); toast('Deleted');
      }
    }
  });
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
}

async function choosePreviewSource(item) {
  if (!window.linkflix?.pickVideoFile || !window.linkflix?.buildPreviewFromFile) {
    toast('Generating a preview from Finder needs the desktop app');
    return;
  }
  if (!await previewServiceReady()) {
    toast('Restart Linkflix once to load the updated preview service');
    return;
  }
  const file = await window.linkflix.pickVideoFile('Choose the first episode for this preview');
  if (!file) return;
  toast('Generating preview from the selected episode…');
  const progress = beginManualPreviewProgress(item.id, item.title);
  const result = await window.linkflix.buildPreviewFromFile(item.id, file).catch(error =>
    ({ ok: false, error: String(error.message || error) }));
  finishManualPreviewProgress(progress, result?.ok);
  if (!result?.ok) {
    const needsRestart = /no handler registered/i.test(result?.error || '');
    toast(needsRestart ? 'Restart Linkflix once to enable preview generation'
      : `Couldn’t generate preview: ${result?.error || 'unknown error'}`);
    return;
  }
  await loadPreviewManifest();
  render();
  toast('Preview generated ✓');
}

/* ---------- subtitle picker / progress modal ---------- */
const STATE_LABEL = {
  'starting': 'Starting…',
  'downloading-model': 'Downloading Whisper model',
  'extracting-audio': 'Extracting audio…',
  'transcribing': 'Transcribing',
  'error': 'Failed'
};

let pollTimer = null;

function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function fetchRows(item) {
  const r = await fetch(`/api/subtitles/list/${encodeURIComponent(item.id)}`);
  if (!r.ok) throw new Error('list failed');
  return r.json();
}

function rowHtml(item, row) {
  const key = `${row.s}-${row.e}`;
  let right;
  if (row.hasSubs) right = `<span class="sub-done">✓ Subtitles</span>`;
  else if (row.job && row.job !== 'idle' && row.job !== 'error' && row.job !== 'done')
    right = `<span class="sub-progress" data-sub-progress="${key}">${STATE_LABEL[row.job] || row.job}…</span>`;
  else right = `<button type="button" class="pill-btn small" data-sub-gen="${key}">Generate</button>`;
  return `<div class="scan-row" data-sub-row="${key}">
    <span class="scan-info"><b>${esc(row.title)}</b></span>${right}
  </div>`;
}

export async function openSubtitleCenter(item) {
  stopPolling();
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass" id="sub-form">
      <div class="modal-head"><h2>Generate subtitles</h2></div>
      <div class="modal-body" id="sub-body">
        <div class="scan-status"><div class="spinner"></div>Checking local files…</div>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">Close</button>
      </div>
    </form>
  </div>`;
  const form = $('#sub-form');
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('click', async e => {
    if (e.target.closest('[data-action="close-modal"]')) { stopPolling(); $('#modal-root').innerHTML = ''; return; }
    const gen = e.target.closest('[data-sub-gen]');
    if (gen) {
      const [s, ep] = gen.dataset.subGen.split('-').map(Number);
      gen.outerHTML = `<span class="sub-progress" data-sub-progress="${s}-${ep}">Starting…</span>`;
      try {
        const r = await fetch('/api/subtitles/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, s, e: ep })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
        startPolling(item);
      } catch (err) {
        toast(`⚠️ ${err.message || err}`);
        renderBody(item);
      }
    }
  });
  renderBody(item);
}

async function renderBody(item) {
  const body = $('#sub-body');
  if (!body) return;
  try {
    const d = await fetchRows(item);
    if (!d.rows.length) {
      body.innerHTML = `<div class="scan-status">No local files on this title.<br>
        <span class="hint">Subtitles are generated from a local copy — add one via scan or the edit dialog.</span></div>`;
      return;
    }
    body.innerHTML =
      (d.whisper ? '' : `<div class="hint" style="margin-bottom:10px">Whisper is an optional component.
        Open <b>Settings → Optional components</b> to set it up.</div>`) +
      `<div class="hint" style="margin-bottom:10px">Transcribed on-device with Whisper — nothing leaves
        your Mac. The .vtt is saved next to the video, so IINA and the in-app player pick it up
        automatically.</div>` +
      d.rows.map(r => rowHtml(item, r)).join('');
    if (d.rows.some(r => r.job && !['idle', 'done', 'error'].includes(r.job))) startPolling(item);
  } catch {
    body.innerHTML = `<div class="scan-status">⚠️ Couldn't check this title's files.</div>`;
  }
}

function startPolling(item) {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!$('#sub-form')) { stopPolling(); return; }
    const spans = $$('[data-sub-progress]');
    if (!spans.length) { stopPolling(); return; }
    let anyDone = false;
    for (const span of spans) {
      const [s, ep] = span.dataset.subProgress.split('-').map(Number);
      try {
        const j = await fetch(`/api/subtitles/status/${encodeURIComponent(item.id)}/${s}/${ep}`).then(r => r.json());
        if (j.state === 'done') { anyDone = true; }
        else if (j.state === 'error') {
          span.className = 'sub-error'; span.textContent = `⚠️ ${j.error || 'failed'}`;
          span.removeAttribute('data-sub-progress');
        } else {
          span.textContent = `${STATE_LABEL[j.state] || j.state}${j.pct ? ` ${j.pct}%` : '…'}`;
        }
      } catch { /* transient */ }
    }
    if (anyDone) { toast('Subtitles ready ✓'); renderBody(item); }
  }, 1500);
}
