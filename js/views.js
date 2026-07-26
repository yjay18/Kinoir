/* ================= Views & playback navigation ================= */
import { state, store, saveLibrary, sampleItems } from './state.js';
import { $, $$, esc, toast } from './dom.js';
import { coverSrc, gradientFor, coverHtml } from './covers.js';
import { formatDate, formatShowDates, episodeMeta } from './format.js';
import { itemText, itemCategories, CATEGORY_ORDER, playablePosition } from './taxonomy.js';
import { driveFileId, embedUrl } from './drive.js';
import { hidePop } from './hover.js';
import { focusFirst } from './nav.js';
import { openAddModal, loadFromFolder, importLibraryFile } from './modals.js';
import { initLocalPlayer, destroyLocalPlayer } from './player.js';
import { openMoreMenu } from './subtitles.js';
import { hasPreview, invalidatePreview, previewUrl, requestPreview } from './previews.js';

function localPathFor(item, s = 0, e = 0) {
  if (!item) return '';
  return item.type === 'movie'
    ? (item.localPath || '')
    : (item.seasons?.[s]?.episodes?.[e]?.localPath || '');
}

export function render() {
  hidePop();
  destroyLocalPlayer();
  const main = $('#view');
  if (state.view.name === 'home')   main.innerHTML = homeHtml();
  if (state.view.name === 'detail') main.innerHTML = detailHtml(state.view.id);
  if (state.view.name === 'player') {
    main.innerHTML = playerHtml(state.view);
    const { id, s = 0, e = 0 } = state.view;
    if (localPathFor(state.library.find(i => i.id === id), s, e))
      initLocalPlayer(id, s, e);
  }
  bindView();
  focusFirst();
  if (state.view.name === 'detail') {
    const item = state.library.find(i => i.id === state.view.id);
    if (item && !hasPreview(item.id)) {
      requestPreview(item).then(ready => {
        if (ready && state.view.name === 'detail' && state.view.id === item.id) render();
      });
    }
    const video = $('.hero-video-bg', main);
    if (item && video) video.addEventListener('error', () => {
      invalidatePreview(item.id);
      video.remove();
      requestPreview(item).then(ready => {
        if (ready && state.view.name === 'detail' && state.view.id === item.id) render();
      });
    }, { once: true });
  }
}

/* ---------- Home ---------- */
function matches(item) {
  if (!state.searchQuery) return true;
  const q = state.searchQuery.toLowerCase();
  return (item.title + ' ' + (item.subtitle || '') + ' ' + (item.genre || '') + ' ' +
    formatShowDates(item) + ' ' + itemText(item))
    .toLowerCase().includes(q);
}

function cardHtml(item, sub) {
  return `<button class="card focusable" data-open="${item.id}">
    ${coverHtml(item)}
    <div class="card-label">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-sub">${esc(sub ?? item.subtitle ?? (item.type === 'show'
        ? `${(item.seasons || []).length} season${(item.seasons || []).length === 1 ? '' : 's'}`
        : 'Movie'))}</div>
    </div>
  </button>`;
}

function rowHtml(title, items, subFn) {
  if (!items.length) return '';
  return `<section class="row-section">
    <div class="row-title">${esc(title)}<span class="count">${items.length}</span></div>
    <div class="row-wrap">
      <button class="row-arrow left" data-scroll="-1" title="Scroll left">‹</button>
      <div class="row" data-navrow>${items.map(i => cardHtml(i, subFn && subFn(i))).join('')}</div>
      <button class="row-arrow right" data-scroll="1" title="Scroll right">›</button>
    </div>
  </section>`;
}

function groupedRowsHtml(items) {
  const rows = new Map();
  for (const item of items) {
    for (const label of itemCategories(item)) {
      if (label === 'Movies' || label === 'TV Shows') continue;
      if (!rows.has(label)) rows.set(label, []);
      const bucket = rows.get(label);
      if (!bucket.some(i => i.id === item.id)) bucket.push(item);
    }
  }
  return [...rows.entries()]
    .map(([label, rowItems]) => ({
      label,
      items: rowItems,
      order: CATEGORY_ORDER.indexOf(label)
    }))
    .sort((a, b) =>
      (a.order < 0 ? 999 : a.order) - (b.order < 0 ? 999 : b.order) ||
      b.items.length - a.items.length ||
      a.label.localeCompare(b.label))
    .map(g => rowHtml(g.label, g.items))
    .join('');
}

/* ---------- Hero (rotates through your titles every so often) ---------- */
let heroPool = [], heroIndex = 0, heroTimer = null;

function heroHtml(item) {
  const resume = state.watchLog.some(w => w.itemId === item.id);
  const dates = formatShowDates(item);
  return `<section class="hero glass">
    <div class="hero-backdrop" style="background:${coverSrc(item)
      ? `url('${esc(coverSrc(item))}') center/cover` : gradientFor(item.title)}"></div>
    <button class="hero-side hero-side-left focusable" data-hero-prev title="Previous featured title" aria-label="Previous featured title">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>
    </button>
    <button class="hero-side hero-side-right focusable" data-hero-next title="Next featured title" aria-label="Next featured title">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg>
    </button>
    <button class="hero-refresh focusable" data-hero-refresh title="Refresh featured picks" aria-label="Refresh featured picks">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.6 7.2A7.2 7.2 0 1 0 19 12"/><path d="M17.6 3.8v3.4H21"/></svg>
    </button>
    <div class="hero-cover card" style="cursor:default">${coverHtml(item)}</div>
    <div class="hero-info">
      <div class="badges">
        <span class="badge">${item.type === 'show' ? 'Series' : 'Film'}</span>
        ${item.genre ? `<span class="badge">${esc(item.genre)}</span>` : ''}
        ${dates ? `<span class="badge">${esc(dates)}</span>` : ''}
        ${item.type === 'show' ? `<span class="badge">${(item.seasons || []).length} seasons</span>` : ''}
      </div>
      <h1>${esc(item.title)}</h1>
      <p class="hero-sub">${esc(item.subtitle || 'From your personal collection.')}</p>
      <div class="hero-actions" data-navrow>
        <button class="pill-btn accent focusable" data-play-featured="${item.id}">${resume ? 'Resume' : 'Play'}</button>
        <button class="pill-btn focusable" data-open="${item.id}">Details</button>
      </div>
    </div>
  </section>`;
}

function buildHeroPool(items, force = false) {
  const ids = new Set(items.map(i => i.id));
  heroPool = heroPool.filter(id => ids.has(id));
  if (!force && heroPool.length) {
    heroIndex %= heroPool.length;
    return;
  }
  heroPool = sampleItems(items, 5).map(i => i.id);
  heroIndex = 0;
}

function currentHeroItem() {
  return state.library.find(i => i.id === heroPool[heroIndex]);
}

function updateHeroSlot() {
  const slot = $('#hero-slot');
  const item = currentHeroItem();
  if (!slot || !item) return;
  const hadFocus = slot.contains(document.activeElement);
  slot.innerHTML = heroHtml(item);
  if (hadFocus) $('.focusable', slot)?.focus();
}

function moveHero(delta) {
  if (!heroPool.length) return;
  heroIndex = (heroIndex + delta + heroPool.length) % heroPool.length;
  updateHeroSlot();
}

function refreshHeroPool(showToast = false) {
  const items = state.library.filter(matches);
  if (!items.length || state.searchQuery) return;
  buildHeroPool(items, true);
  updateHeroSlot();
  scheduleHeroRotation();
  if (showToast) toast(`Refreshed ${heroPool.length} featured pick${heroPool.length === 1 ? '' : 's'} ✓`);
}

function scheduleHeroRotation() {
  clearInterval(heroTimer);
  if (heroPool.length < 2) return;
  heroTimer = setInterval(() => {
    const slot = $('#hero-slot');
    if (!slot || state.view.name !== 'home') { clearInterval(heroTimer); return; }
    if (slot.matches(':hover')) return;             // paused while you're looking at it
    moveHero(1);
  }, 12000);
}

function homeHtml() {
  const items = state.library.filter(matches);
  if (!state.library.length) {
    return `<div class="empty glass">
      <div class="big">🎬</div>
      <h2>Welcome to Linkflix</h2>
      <p>Your personal cinema. Add a movie or show with a Drive link —
         or load a shared library.</p>
      <div class="hero-actions" data-navrow>
        <button class="pill-btn accent focusable" data-action="add">Add your first title <kbd>A</kbd></button>
        <button class="pill-btn focusable" data-action="scan">Scan library folder</button>
        <button class="pill-btn focusable" data-action="import">Import JSON</button>
      </div>
    </div>`;
  }

  const continueItems = [];
  for (const log of state.watchLog) {
    const item = state.library.find(i => i.id === log.itemId);
    if (item && matches(item) && !continueItems.some(c => c.item.id === item.id))
      continueItems.push({ item, log });
  }

  let hero = '';
  if (items.length && !state.searchQuery) {
    buildHeroPool(items);
    const featured = currentHeroItem() || items[0];
    hero = `<div id="hero-slot">${heroHtml(featured)}</div>`;
    scheduleHeroRotation();
  } else clearInterval(heroTimer);

  const cw = rowHtml('Continue Watching', continueItems.map(c => c.item), item => {
    const log = continueItems.find(c => c.item.id === item.id).log;
    return item.type === 'show' ? `S${log.s + 1} · E${log.e + 1}` : 'Resume';
  });

  let genreRows = '';
  if (state.settings.groupByGenre) genreRows = groupedRowsHtml(items);

  const watchedRow = rowHtml('Watched', items.filter(i => i.watched));

  if (state.searchQuery) {
    const isSemantic = state.semanticResults && state.semanticResults.length > 0;
    if (isSemantic) {
      const exactIds = new Set(items.map(i => i.id));
      const semanticExtra = state.semanticResults.filter(i => !exactIds.has(i.id));
      items = [...items, ...semanticExtra];
    }
    if (!items.length) {
      return `<div class="empty glass"><div class="big">⌕</div>
        <h2>No matches for “${esc(state.searchQuery)}”</h2><p>Try a different search.</p></div>`;
    }
    return `<section class="row-section">
      <div class="row-title">Search Results 
        ${isSemantic ? '<span class="badge accent" style="margin-left:8px; font-size:11px">✨ AI Semantic Match</span>' : ''}
      </div>
      <div class="row-wrap">
         <div class="row search-grid" style="display: flex; flex-wrap: wrap; gap: 16px; padding: 0 40px 40px 40px;">
           ${items.map(i => cardHtml(i)).join('')}
         </div>
      </div>
    </section>`;
  }

  const body =
    hero + cw + watchedRow + genreRows +
    rowHtml('Movies', items.filter(i => i.type === 'movie')) +
    rowHtml('TV Shows', items.filter(i => i.type === 'show'));

  return body;
}

/* ---------- Detail ---------- */
function detailHtml(id) {
  const item = state.library.find(i => i.id === id);
  if (!item) { state.view = { name: 'home' }; return homeHtml(); }
  const dates = formatShowDates(item);
  const inContinueWatching = state.watchLog.some(w => w.itemId === item.id);

  const head = `<section class="hero hero-detail glass">
    <button class="detail-back focusable" data-action="back" title="Back" aria-label="Back">Back <kbd>⎋</kbd></button>
    ${hasPreview(item.id) ? `<video class="hero-video-bg" src="${previewUrl(item.id)}" autoplay loop playsinline onplaying="this.classList.add('on'); this.nextElementSibling.classList.add('off')" onerror="this.remove()"></video>` : ''}
    <div class="hero-backdrop" style="background:${coverSrc(item)
      ? `url('${esc(coverSrc(item))}') center/cover` : gradientFor(item.title)}"></div>
    ${hasPreview(item.id) ? `<div class="hero-video-overlay"></div>` : ''}
    <button class="hero-mark ${item.watched ? 'on' : ''} focusable" data-toggle-watched="${item.id}"
      title="${item.watched ? 'Watched — click to unmark' : 'Mark as watched'}"
      aria-label="${item.watched ? 'Watched — click to unmark' : 'Mark as watched'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>
    </button>
    <div class="hero-cover card" style="cursor:default">${coverHtml(item)}</div>
    <div class="hero-info">
      <div class="badges">
        <span class="badge">${item.type === 'show' ? 'Series' : 'Film'}</span>
        ${item.genre ? `<span class="badge">${esc(item.genre)}</span>` : ''}
        ${dates ? `<span class="badge">${esc(dates)}</span>` : ''}
        ${item.watched ? '<span class="badge watched">Watched</span>' : ''}
      </div>
      <h1>${esc(item.title)}</h1>
      <p class="hero-sub">${esc(item.subtitle || '')}</p>
      <div class="hero-actions" data-navrow>
        ${item.type === 'movie'
          ? `<button class="pill-btn accent focusable" data-play="${item.id}">Play</button>` : ''}
        ${item.type === 'movie' && item.localPath && window.linkflix?.openExternalFile
          ? `<button class="pill-btn focusable" data-open-external="${item.id}">Open in IINA</button>` : ''}
        ${inContinueWatching
          ? `<button class="pill-btn focusable" data-clear-watch="${item.id}">Remove from Continue Watching</button>` : ''}
        <button class="pill-btn focusable" data-more="${item.id}" title="More actions"
          aria-label="More actions">⋯</button>
      </div>
    </div>
  </section>`;

  let body = '';
  if (item.type === 'show') {
    const seasons = item.seasons || [];
    let defaultSeason = 0;
    if (state.view.season === undefined) {
      const lastWatched = state.watchLog.find(w => w.itemId === item.id);
      if (lastWatched) defaultSeason = lastWatched.s;
    } else {
      defaultSeason = state.view.season;
    }
    const selectedSeason = Math.min(Math.max(+defaultSeason, 0), Math.max(0, seasons.length - 1));
    const season = seasons[selectedSeason];
    body = `<div class="detail-body">
      ${seasons.length > 1 ? `<div class="season-picker glass">
        <label for="season-select">Season</label>
        <select id="season-select" class="focusable" data-season-select>
          ${seasons.map((s, si) => `<option value="${si}" ${si === selectedSeason ? 'selected' : ''}>
            ${esc(s.name || `Season ${si + 1}`)} · ${(s.episodes || []).length} episodes
          </option>`).join('')}
        </select>
      </div>` : ''}
      <div class="season-block">
        <div class="season-title">${esc(season?.name || `Season ${selectedSeason + 1}`)}</div>
        <div class="ep-list" data-navrow>
          ${(season?.episodes || []).map((ep, ei) => `
            <button class="ep-btn focusable" data-play="${item.id}" data-s="${selectedSeason}" data-e="${ei}">
              <span class="ep-num">${ei + 1}</span>
              <span class="ep-info">
                <div class="ep-title">${esc(ep.title || `Episode ${ei + 1}`)}</div>
                ${episodeMeta(ep) ? `<div class="ep-sub">${esc(episodeMeta(ep))}</div>` : ''}
              </span>
              <span class="ep-play"></span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  }
  return head + body;
}

/* ---------- Player ---------- */
function playerHtml({ id, s, e }) {
  const item = state.library.find(i => i.id === id);
  if (!item) { state.view = { name: 'home' }; return homeHtml(); }
  let link = item.link, localPath = item.localPath, sub = 'Movie';
  if (item.type === 'show') {
    const ep = item.seasons?.[s]?.episodes?.[e];
    link = ep?.link;
    localPath = ep?.localPath;
    sub = `S${s + 1} · E${e + 1}${ep?.title ? ' — ' + ep.title : ''}${ep?.airdate ? ` · ${formatDate(ep.airdate)}` : ''}`;
  }
  // log for Continue Watching
  state.watchLog = [{ itemId: id, s: s ?? 0, e: e ?? 0, ts: Date.now() },
    ...state.watchLog.filter(w => w.itemId !== id)].slice(0, 20);
  store.set('watchLog', state.watchLog);

  const top = `<div class="player-top glass">
      <button class="pill-btn small focusable" data-action="back">Back <kbd>⎋</kbd></button>
      <span class="pt-title">${esc(item.title)}</span>
      <span class="pt-sub">${esc(sub)}</span>
    </div>`;

  if (localPath) {
    return `<div class="player">
      ${top}
      <video id="local-video" class="local-video" controls autoplay playsinline crossorigin="anonymous"></video>
      <div id="player-status" class="player-status"></div>
    </div>`;
  }

  const src = embedUrl(link);
  const valid = driveFileId(link);
  return `<div class="player">
    ${top}
    ${valid
      ? `<iframe src="${esc(src)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : `<div class="empty" style="margin:auto"><div class="big"></div>
          <h2>Nothing to play yet</h2>
          <p>Add a Drive link or a local file for this title.</p></div>`}
  </div>`;
}

function rememberWatchPosition(id, s = 0, e = 0) {
  state.watchLog = [{ itemId: id, s, e, ts: Date.now() },
    ...state.watchLog.filter(w => w.itemId !== id)].slice(0, 20);
  store.set('watchLog', state.watchLog);
}

export function removeFromContinueWatching(id) {
  const before = state.watchLog.length;
  state.watchLog = id ? state.watchLog.filter(w => w.itemId !== id) : [];
  store.set('watchLog', state.watchLog);
  return state.watchLog.length !== before;
}

function episodePlayable(item, s, e) {
  const ep = item?.seasons?.[s]?.episodes?.[e];
  return !!(ep && (ep.localPath || driveFileId(ep.link)));
}

// Every local file in the desktop app goes to IINA. This intentionally includes
// MP4/MOV files so macOS/Chromium never chooses QuickTime or the in-app player.
function useNativePlayer(item, s = 0, e = 0) {
  const p = localPathFor(item, s, e);
  return Boolean(p && window.linkflix?.playNative);
}

function playLocalNative(item, s = 0, e = 0) {
  const p = localPathFor(item, s, e);
  rememberWatchPosition(item.id, s, e);
  const label = item.type === 'show' ? `${item.title} — S${s + 1}E${e + 1}` : item.title;
  // Collect remaining episode paths in the season for auto-advance (⏭ in mpv)
  let playlist = [];
  if (item.type === 'show') {
    const eps = item.seasons?.[s]?.episodes || [];
    playlist = eps.slice(e + 1).map(ep => ep.localPath).filter(Boolean);
  }
  window.linkflix.playNative(p, label, playlist, Boolean(state.settings.alwaysPip)).then(r => {
    if (r?.ok) {
      const name = { mpv: 'mpv', iina: 'IINA', vlc: 'VLC', system: 'your player' }[r.player] || 'your player';
      toast(`Playing in ${name}`);
    } else {                                   // fall back to the in-app HLS player
      toast('Native player unavailable — playing in-app');
      state.view = { name: 'player', id: item.id, s, e }; render();
    }
  }).catch(() => { state.view = { name: 'player', id: item.id, s, e }; render(); });
}

export function playEpisode(id, s = 0, e = 0) {
  const item = state.library.find(i => i.id === id);
  if (!item || item.type !== 'show') return false;
  if (!episodePlayable(item, s, e)) {
    toast('That episode needs a Drive link or local file first.');
    return false;
  }
  if (useNativePlayer(item, s, e)) { playLocalNative(item, s, e); return true; }
  state.view = { name: 'player', id, s, e };   // playerHtml logs Continue Watching
  render();
  return true;
}

export function playItem(id) {                 // resume where you left off, else first playable
  const item = state.library.find(i => i.id === id);
  if (!item) return;
  const fallback = playablePosition(item) || { s: 0, e: 0 };
  const log = state.watchLog.find(w => w.itemId === id);
  if (item.type === 'show') {
    const canResume = log && episodePlayable(item, log.s, log.e);
    playEpisode(id, canResume ? log.s : fallback.s, canResume ? log.e : fallback.e);
    return;
  }
  if (useNativePlayer(item, 0, 0)) { playLocalNative(item, 0, 0); return; }
  state.view = { name: 'player', id, s: 0, e: 0 };
  render();
}

export function goBack() {
  state.view = state.view.name === 'player'
    ? { name: 'detail', id: state.view.id }
    : { name: 'home' };
  render();
}

/* ---------- Event wiring for the current view ---------- */
function bindView() {
  $('#view').onclick = e => {
    const open = e.target.closest('[data-open]');
    if (open) { state.view = { name: 'detail', id: open.dataset.open }; render(); return; }

    const seasonSelect = e.target.closest('[data-season-select]');
    if (seasonSelect) return;

    const play = e.target.closest('[data-play]');
    if (play) {
      const item = state.library.find(i => i.id === play.dataset.play);
      if (item?.type === 'show') {
        playEpisode(item.id, +(play.dataset.s ?? 0), +(play.dataset.e ?? 0));
        return;
      }
      if (useNativePlayer(item, 0, 0)) { playLocalNative(item, 0, 0); return; }
      state.view = { name: 'player', id: play.dataset.play,
        s: +(play.dataset.s ?? 0), e: +(play.dataset.e ?? 0) };
      render(); return;
    }
    const openExt = e.target.closest('[data-open-external]');
    if (openExt) {
      const item = state.library.find(i => i.id === openExt.dataset.openExternal);
      const p = localPathFor(item, 0, 0);
      if (p && window.linkflix?.openExternalFile) {
        window.linkflix.openExternalFile(p);
        toast('Opening in IINA…');
      }
      return;
    }
    const featured = e.target.closest('[data-play-featured]');
    if (featured) { playItem(featured.dataset.playFeatured); return; }
    if (e.target.closest('[data-hero-prev]')) { moveHero(-1); return; }
    if (e.target.closest('[data-hero-next]')) { moveHero(1); return; }
    if (e.target.closest('[data-hero-refresh]')) { refreshHeroPool(true); return; }
    const clearWatch = e.target.closest('[data-clear-watch]');
    if (clearWatch) {
      const item = state.library.find(i => i.id === clearWatch.dataset.clearWatch);
      if (removeFromContinueWatching(clearWatch.dataset.clearWatch)) {
        render();
        toast(`Removed “${item?.title || 'title'}” from Continue Watching`);
      }
      return;
    }
    const markWatched = e.target.closest('[data-toggle-watched]');
    if (markWatched) {
      const item = state.library.find(i => i.id === markWatched.dataset.toggleWatched);
      if (item) {
        item.watched = !item.watched;
        saveLibrary();
        render();
        toast(item.watched ? `Marked “${item.title}” as watched ✓` : `Removed “${item.title}” from watched`);
      }
      return;
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      openMoreMenu(more, state.library.find(i => i.id === more.dataset.more));
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openAddModal(edit.dataset.edit); return; }

    const del = e.target.closest('[data-delete]');
    if (del) {
      const item = state.library.find(i => i.id === del.dataset.delete);
      if (confirm(`Delete “${item.title}” from your library?`)) {
        state.library = state.library.filter(i => i.id !== item.id);
        state.watchLog = state.watchLog.filter(w => w.itemId !== item.id);
        saveLibrary(); store.set('watchLog', state.watchLog);
        state.view = { name: 'home' }; render(); toast('Deleted');
      }
      return;
    }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const row = $('.row', scroll.closest('.row-wrap'));
      row.scrollBy({ left: +scroll.dataset.scroll * row.clientWidth * 0.8, behavior: 'smooth' });
      return;
    }
    const action = e.target.closest('[data-action]');
    if (action) {
      const a = action.dataset.action;
      if (a === 'back') goBack();
      if (a === 'add') openAddModal();
      if (a === 'scan') loadFromFolder(false);
      if (a === 'import') importLibraryFile();
    }
  };

  const seasonSelect = $('[data-season-select]');
  if (seasonSelect) {
    seasonSelect.onchange = e => {
      state.view = { name: 'detail', id: state.view.id, season: +e.target.value };
      render();
    };
  }
}
