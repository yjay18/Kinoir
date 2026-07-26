/* Folder auto-scan: ask the server to walk the media roots, enrich each new file
   with TVMaze (shows) / Wikipedia (movies) — using the local llama model to clean
   up filenames it can't match — then let the user confirm before merging into the
   library. Also offers to delete titles that have no Drive link or local file. */

import { state, saveLibrary, uid } from './state.js';
import { $, $$, esc, toast } from './dom.js';
import { searchTVMaze, tvmazeEpisodes, wikiLookup, withTimeout } from './metadata.js';
import { isPlayable } from './taxonomy.js';
import { gradientFor } from './covers.js';
import { render } from './views.js';
import { findLibraryTitleMatch } from './titlematch.js';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// strip Wikipedia disambiguation, e.g. "Interstellar (film)" -> "Interstellar"
const cleanWiki = t => String(t || '')
  .replace(/\s*\([^)]*\b(film|movie|tv series|series|miniseries)\b[^)]*\)\s*$/i, '').trim();

let scanState = null;

/* ---- local-model helpers (clean a title out of a messy filename) ---- */
async function llmComplete(prompt) {
  try {
    const res = await fetch('/api/concierge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: state.settings.model || 'llama3.2', temperature: 0,
        messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok || !res.body) return '';
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const o = JSON.parse(line); out += o.message?.content || ''; if (o.done) return out.trim(); } catch { /* skip */ }
      }
    }
    return out.trim();
  } catch { return ''; }
}

async function llmTitle(rawName, kind) {
  const t = await llmComplete(
    `Extract the ${kind === 'movie' ? 'movie' : 'TV show'} name from this media filename. ` +
    `Reply with ONLY the name — no year, no season/episode, no quality tags, no punctuation, nothing else.\n\nFilename: "${rawName}"`);
  return t.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 80).trim();
}

/* ---- enrichment ---- */
async function enrichMovie(cand) {
  const q = cand.year ? `${cand.title} ${cand.year} film` : `${cand.title} film`;
  let info = await withTimeout(wikiLookup(q), 6000).catch(() => null);
  if (!info || !info.summary) {
    const t = await llmTitle(cand.rawName, 'movie');
    if (t && norm(t) !== norm(cand.title)) {
      cand.title = t;
      info = await withTimeout(wikiLookup(`${t} film`), 6000).catch(() => null);
    }
  }
  return info && (info.summary || info.image) ? info : null;
}

async function enrichShow(cand) {
  let info = (await withTimeout(searchTVMaze(cand.show), 6000).catch(() => []))[0];
  if (!info) {
    const t = await llmTitle(cand.rawName, 'show');
    if (t && norm(t) !== norm(cand.show)) {
      cand.show = t;
      info = (await withTimeout(searchTVMaze(t), 6000).catch(() => []))[0];
    }
  }
  if (!info) return null;
  const seasons = await withTimeout(tvmazeEpisodes(info.id), 8000).catch(() => []);
  return { info, seasons };
}

/* ---- orchestration ---- */
export async function openScanFlow() {
  const roots = Array.isArray(state.settings.mediaRoots) ? state.settings.mediaRoots : [];
  scanModal(`<div class="scan-status"><div class="spinner"></div>Scanning media folders…</div>`);

  let data;
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots })
    });
    data = await res.json();
    if (!data.ok) throw new Error(data.error || 'scan failed');
  } catch (e) {
    scanModal(`<div class="scan-status">⚠️ Couldn't scan: ${esc(String(e.message || e))}<br>
      <span class="hint">Local scanning needs the desktop app (Electron/server.py).</span></div>`,
      true);
    return;
  }

  const newMovies = data.movies.filter(m => m.isNew);
  const newShows = data.shows
    .map(s => ({ ...s, episodes: s.episodes.filter(e => e.isNew) }))
    .filter(s => s.episodes.length);

  if (!newMovies.length && !newShows.length) {
    scanModal(`<div class="scan-status">✓ No new video files found.<br>
      <span class="hint">Scanned ${data.counts.files} file(s) across ${data.roots.length} folder(s).
      Drop movies/shows in the app's <b>Media/</b> folder or add a folder below.</span></div>`, true);
    return;
  }

  const total = newMovies.length + newShows.length;
  let done = 0;
  const tick = label => scanModal(
    `<div class="scan-status"><div class="spinner"></div>Identifying ${done + 1}/${total}…<br>
     <span class="hint">${esc(label)}</span></div>`);

  const movies = [];
  for (const cand of newMovies) {
    tick(cand.title);
    const existing = findLibraryTitleMatch(state.library, 'movie', cand.title);
    movies.push({ cand, existing, info: existing ? null : await enrichMovie(cand) });
    done++;
  }
  const shows = [];
  for (const group of newShows) {
    tick(group.show);
    const existing = findLibraryTitleMatch(state.library, 'show', group.show);
    shows.push({ group, existing, enriched: existing ? null : await enrichShow(group) });
    done++;
  }

  const sourceless = state.library.filter(i => !isPlayable(i));
  scanState = { movies, shows, sourceless };
  renderReview();
}

/* ---- review modal ---- */
function thumb(title, image, letter) {
  return image
    ? `<span class="scan-thumb" style="background-image:url('${esc(image)}')"></span>`
    : `<span class="scan-thumb" style="background:${gradientFor(title)}">${esc(letter)}</span>`;
}

function renderReview() {
  const { movies, shows, sourceless } = scanState;
  const matched = [];
  const review = [];

  movies.forEach((m, i) => {
    const row = { kind: 'movie', i, title: m.existing?.title || cleanWiki(m.info?.title) || m.cand.title,
      image: m.existing?.cover || m.info?.image || '',
      sub: m.existing ? `Existing film · ${m.cand.rawName}` : (m.info ? 'Film' : `Film · ${m.cand.rawName}`),
      matched: !!(m.existing || m.info) };
    (row.matched ? matched : review).push(row);
  });
  shows.forEach((s, i) => {
    const n = s.group.episodes.length;
    const row = { kind: 'show', i, title: s.existing?.title || s.enriched?.info?.title || s.group.show,
      image: s.existing?.cover || s.enriched?.info?.image || '',
      sub: `${s.existing ? 'Existing series' : (s.enriched ? 'Series' : 'Series · ' + s.group.episodes[0].rawName)} · ${n} episode${n === 1 ? '' : 's'}`,
      matched: !!(s.existing || s.enriched) };
    (row.matched ? matched : review).push(row);
  });

  const rowHtml = r => `<label class="scan-row">
    <input type="checkbox" checked data-kind="${r.kind}" data-i="${r.i}">
    ${thumb(r.title, r.image, (r.title[0] || '?').toUpperCase())}
    <span class="scan-info">
      ${r.matched
        ? `<b>${esc(r.title)}</b>`
        : `<input class="scan-title-edit" data-kind="${r.kind}" data-i="${r.i}" value="${esc(r.title)}" placeholder="Type the correct title">`}
      <small>${esc(r.sub)}</small>
    </span>
  </label>`;

  const cleanupHtml = sourceless.map((it, i) => `<label class="scan-row cleanup">
    <input type="checkbox" data-cleanup="${i}">
    ${thumb(it.title, '', (it.title[0] || '?').toUpperCase())}
    <span class="scan-info"><b>${esc(it.title)}</b><small>${it.type === 'show' ? 'Series' : 'Film'} · no Drive link or local file</small></span>
  </label>`).join('');

  scanModal(`
    ${matched.length ? `<div class="scan-section">
      <div class="scan-h">✓ Ready to add (${matched.length})</div>
      ${matched.map(rowHtml).join('')}</div>` : ''}
    ${review.length ? `<div class="scan-section">
      <div class="scan-h">Couldn't identify — confirm or fix the title (${review.length})</div>
      ${review.map(rowHtml).join('')}</div>` : ''}
    ${sourceless.length ? `<div class="scan-section">
      <div class="scan-h">Titles with no link or file (${sourceless.length}) — tick any to delete</div>
      ${cleanupHtml}</div>` : ''}
  `, false, true);
}

/* ---- apply ---- */
function seasonsFromTvmaze(seasons) {
  return seasons.map(s => ({
    name: s.name,
    episodes: s.episodes.map(ep => ({
      tvmazeId: ep.tvmazeId, season: ep.season, number: ep.number,
      title: ep.title, airdate: ep.airdate, subtitle: ep.subtitle, link: '', localPath: ''
    }))
  }));
}

function placeEpisode(show, file) {
  for (const se of show.seasons || [])
    for (const ep of se.episodes || [])
      if (+ep.season === file.season && +ep.number === file.episode) { ep.localPath = file.path; return; }
  // no metadata episode matched — add a bare one under the right season
  show.seasons = show.seasons || [];
  let sb = show.seasons.find(se => new RegExp(`(^|\\D)0*${file.season}(\\D|$)`).test(se.name)
    || (se.episodes || []).some(e => +e.season === file.season));
  if (!sb) { sb = { name: file.season === 0 ? 'Specials' : `Season ${file.season}`, episodes: [] }; show.seasons.push(sb); }
  sb.episodes.push({ season: file.season, number: file.episode,
    title: file.epTitle || `Episode ${file.episode}`, airdate: '', subtitle: '', link: '', localPath: file.path });
  sb.episodes.sort((a, b) => (+a.number) - (+b.number));
}

function applyMovie(m, title) {
  const info = m.info;
  const finalTitle = title || cleanWiki(info?.title) || m.cand.title;
  const existing = (m.existing && state.library.find(i => i.id === m.existing.id)) ||
    findLibraryTitleMatch(state.library, 'movie', finalTitle);
  if (existing) {
    existing.localPath = m.cand.path;
    if (info?.image && !existing.cover) existing.cover = info.image;
    if (info?.summary && !existing.subtitle) existing.subtitle = info.summary.slice(0, 180);
    return;
  }
  state.library.unshift({
    id: uid(), type: 'movie', title: finalTitle, genre: '',
    subtitle: info?.summary ? info.summary.slice(0, 180) : '', cover: info?.image || '',
    wikiTitle: info?.wikiTitle || '', localPath: m.cand.path, added: Date.now()
  });
}

function applyShow(s, title) {
  const info = s.enriched?.info;
  const finalTitle = title || info?.title || s.group.show;
  let show = (s.existing && state.library.find(i => i.id === s.existing.id)) ||
    state.library.find(i => i.type === 'show' && info && String(i.tvmazeId) === String(info.id)) ||
    findLibraryTitleMatch(state.library, 'show', finalTitle);
  if (!show) {
    show = {
      id: uid(), type: 'show', title: finalTitle,
      genre: (info?.genres || []).slice(0, 2).join(' · '),
      subtitle: info?.summary ? info.summary.slice(0, 180) : '', cover: info?.image || '',
      tvmazeId: info ? String(info.id) : '', dates: '', added: Date.now(),
      seasons: s.enriched ? seasonsFromTvmaze(s.enriched.seasons) : []
    };
    state.library.unshift(show);
  } else if (!(show.seasons || []).length && s.enriched) {
    show.seasons = seasonsFromTvmaze(s.enriched.seasons);
  }
  for (const file of s.group.episodes) placeEpisode(show, file);
}

function applyReview() {
  const edits = {};
  $$('.scan-title-edit').forEach(inp => { edits[`${inp.dataset.kind}:${inp.dataset.i}`] = inp.value.trim(); });

  let added = 0;
  $$('#scan-form input[type="checkbox"][data-kind]').forEach(cb => {
    if (!cb.checked) return;
    const i = +cb.dataset.i;
    const title = edits[`${cb.dataset.kind}:${i}`];
    if (cb.dataset.kind === 'movie') applyMovie(scanState.movies[i], title);
    else applyShow(scanState.shows[i], title);
    added++;
  });

  // deletions — only titles that are STILL sourceless after the additions above
  let deleted = 0;
  const toDelete = new Set();
  $$('#scan-form input[type="checkbox"][data-cleanup]').forEach(cb => {
    if (cb.checked) toDelete.add(scanState.sourceless[+cb.dataset.cleanup].id);
  });
  if (toDelete.size) {
    state.library = state.library.filter(i => {
      if (toDelete.has(i.id) && !isPlayable(i)) { deleted++; return false; }
      return true;
    });
  }

  saveLibrary();
  closeScanModal();
  render();
  toast(`Scan complete — added ${added}${deleted ? `, removed ${deleted}` : ''} ✓`);
}

/* ---- modal shell ---- */
function scanModal(inner, dismissable = false, review = false) {
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass scan-modal" id="scan-form">
      <div class="modal-head"><h2>${review ? 'Scan results' : 'Scan media'}</h2></div>
      <div class="modal-body">${inner}</div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">${review || dismissable ? 'Cancel' : 'Close'}</button>
        ${review ? '<button type="submit" class="pill-btn accent">Apply</button>' : ''}
      </div>
    </form>
  </div>`;
  const form = $('#scan-form');
  form.addEventListener('submit', e => { e.preventDefault(); if (review) applyReview(); });
  form.addEventListener('click', e => {
    if (e.target.closest('[data-action="close-modal"]')) closeScanModal();
  });
}

function closeScanModal() { $('#modal-root').innerHTML = ''; scanState = null; }
