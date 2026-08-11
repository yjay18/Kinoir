/* ================= Modals (add / edit / settings / folder IO) ================= */
import { state, store, saveLibrary, saveSettings, uid } from './state.js';
import { $, $$, esc, toast } from './dom.js';
import { coverFromFile } from './covers.js';
import { formatShowDates } from './format.js';
import { searchTVMaze, tvmazeShow, tvmazeEpisodes, wikiSummary, wikiLookup, withTimeout } from './metadata.js';
import { render, removeFromContinueWatching } from './views.js';
import { syncSuggestionScopeUi } from './concierge.js';
import { focusFirst } from './nav.js';
import { openScanFlow } from './scan.js';
import { loadPreviewManifest, startPreviewWorker } from './previews.js';
import { THEMES, applyTheme } from './theme.js';

let onModalClose = null;
export function closeModal() {
  const cleanup = onModalClose;
  onModalClose = null;
  cleanup?.();
  $('#modal-root').innerHTML = '';
  focusFirst();
}
export function modalOpen() { return !!$('#modal-root').firstElementChild; }

/* ---------- First-run welcome ---------- */
export function openWelcome() {
  if (modalOpen()) return;
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <div class="modal glass welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="modal-head"><h2 id="welcome-title">Welcome to Kinoir</h2></div>
      <div class="modal-body">
        <p class="welcome-lead">Your personal media library stays on this Mac. Start with the
          core app, then enable only the optional tools you want.</p>
        <div class="welcome-steps">
          <div><span>1</span><b>Add your library</b><small>Scan a media folder, add a title, or import an existing library file.</small></div>
          <div><span>2</span><b>Choose optional tools</b><small>Ollama, IINA, and Whisper are detected from installed copies and are never required to browse.</small></div>
          <div><span>3</span><b>Share deliberately</b><small>Kinoir Air starts off. Turn it on only when you want a paired device to connect.</small></div>
        </div>
        <p class="hint">Packaged builds keep library data in <b>Movies/Kinoir</b>. Libraries created before the rename continue working in place. Removing a
          media file never removes its title, cover, history, or generated preview.</p>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" id="welcome-later">Explore first</button>
        <button type="button" class="pill-btn accent" id="welcome-settings">Review setup</button>
      </div>
    </div>
  </div>`;
  const finish = openSetup => {
    state.settings.onboardingVersion = 1;
    saveSettings();
    closeModal();
    if (openSetup) openSettings();
  };
  $('#welcome-later').addEventListener('click', () => finish(false));
  $('#welcome-settings').addEventListener('click', () => finish(true));
  $('#welcome-settings').focus();
}

/* ---------- Add / Edit ---------- */
function epEditorHtml(ep = {}) {
  return `<div class="ep-editor" data-tvmaze-id="${esc(ep.tvmazeId || '')}"
    data-season="${esc(ep.season ?? '')}" data-number="${esc(ep.number ?? '')}"
    data-local-path="${esc(ep.localPath || '')}">
    <input placeholder="Episode title" class="f-ep-title" value="${esc(ep.title || '')}">
    <input type="date" class="f-ep-airdate" value="${esc(ep.airdate || '')}" title="Air date">
    <textarea rows="2" placeholder="Episode bio / subtitle (optional)" class="f-ep-sub">${esc(ep.subtitle || '')}</textarea>
    <input placeholder="Drive link" class="f-ep-link" value="${esc(ep.link || '')}">
    <button type="button" class="icon-btn" data-remove-ep title="Remove episode">✕</button>
  </div>`;
}
function seasonEditorHtml(season = {}, idx = 0) {
  return `<div class="season-editor">
    <div class="season-editor-head">
      <input placeholder="Season name" class="f-season-name"
        value="${esc(season.name || `Season ${idx + 1}`)}">
      <button type="button" class="icon-btn" data-remove-season title="Remove season">✕</button>
    </div>
    <div class="ep-editors">
      ${(season.episodes?.length ? season.episodes : [{}]).map(epEditorHtml).join('')}
    </div>
    <button type="button" class="icon-btn" data-add-ep>＋ Episode</button>
  </div>`;
}

function episodeKey(ep, fallbackSeason, fallbackNumber) {
  const season = ep.season ?? fallbackSeason;
  const number = ep.number ?? fallbackNumber;
  return `${season}:${number}`;
}

function titleKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tvmazeShowRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/tvmaze\.com\/shows\/(\d+)/i) ||
    raw.match(/api\.tvmaze\.com\/shows\/(\d+)/i);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(raw) ? raw : '';
}

function wikiPageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  if (fromUrl) return decodeURIComponent(fromUrl[1]).replace(/_/g, ' ');
  if (/^https?:\/\//i.test(raw)) return '';
  return raw;
}

function seasonNumberFromEditor(se, fallback) {
  const name = $('.f-season-name', se)?.value.trim() || '';
  if (/specials?/i.test(name)) return 0;
  const m = name.match(/\d+/);
  return m ? +m[0] : fallback;
}

function currentEpisodeLookups(form) {
  const byId = new Map(), byNumber = new Map(), byTitle = new Map();
  $$('.season-editor', form).forEach((se, si) => {
    const fallbackSeason = seasonNumberFromEditor(se, si + 1);
    $$('.ep-editor', se).forEach((ee, ei) => {
      const ep = {
        tvmazeId: ee.dataset.tvmazeId || '',
        season: ee.dataset.season || fallbackSeason,
        number: ee.dataset.number || (ei + 1),
        title: $('.f-ep-title', ee).value.trim(),
        airdate: $('.f-ep-airdate', ee).value.trim(),
        subtitle: $('.f-ep-sub', ee).value.trim(),
        link: $('.f-ep-link', ee).value.trim()
      };
      if (ep.tvmazeId) byId.set(String(ep.tvmazeId), ep);
      byNumber.set(episodeKey(ep, si + 1, ei + 1), ep);
      const tk = titleKey(ep.title);
      if (tk) byTitle.set(tk, ep);
    });
  });
  return { byId, byNumber, byTitle };
}

function mergeEpisodeLinks(seasons, lookups) {
  let keptLinks = 0;
  for (const season of seasons) {
    for (const ep of season.episodes || []) {
      const match = (ep.tvmazeId && lookups.byId.get(String(ep.tvmazeId))) ||
        lookups.byNumber.get(episodeKey(ep, ep.season, ep.number)) ||
        lookups.byTitle.get(titleKey(ep.title));
      if (match?.link) {
        ep.link = match.link;
        keptLinks++;
      }
    }
  }
  return keptLinks;
}

export function openAddModal(editId = null) {
  const item = editId ? state.library.find(i => i.id === editId) : null;
  const type = item?.type || 'movie';
  let currentTvmazeId = item?.tvmazeId || '';
  let currentWikiTitle = item?.wikiTitle || '';
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass" id="add-form">
      <div class="modal-head">
        <h2>${item ? 'Edit' : 'Add'} title</h2>
        <div class="seg" role="radiogroup" aria-label="Type">
          <button type="button" data-type="movie" class="${type === 'movie' ? 'active' : ''}">Movie</button>
          <button type="button" data-type="show"  class="${type === 'show'  ? 'active' : ''}">TV Show</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>Title</label>
            <input id="f-title" required value="${esc(item?.title || '')}" placeholder="e.g. Interstellar"></div>
          <div class="field"><label>Genre (optional)</label>
            <input id="f-genre" value="${esc(item?.genre || '')}" placeholder="Sci-fi"></div>
        </div>
        <div class="field">
          <button type="button" class="pill-btn" id="btn-autofill">✦ Auto-fill / refresh details from the web</button>
        </div>
        <div class="field-row">
          <div class="field"><label>Subtitle / description (optional)</label>
            <input id="f-subtitle" value="${esc(item?.subtitle || '')}" placeholder="A short tagline or synopsis"></div>
          <div class="field"><label>Dates (optional)</label>
            <input id="f-dates" value="${esc(formatShowDates(item))}" placeholder="2020 - Running"></div>
        </div>
        <div class="field"><label>Cover image (optional)</label>
          <input id="f-cover" value="${esc(item?.cover?.startsWith('data:') ? '' : (item?.cover || ''))}"
            placeholder="https://…/poster.jpg">
          <div class="hero-actions" style="margin-top:8px; align-items:center">
            <button type="button" class="icon-btn" id="btn-upload-cover">⇧ Upload image</button>
            <span class="hint" id="cover-status" style="margin:0">${item?.cover?.startsWith('data:')
              ? 'Using uploaded cover ✓' : ''}</span>
          </div>
          <input type="file" id="f-cover-file" accept="image/*" hidden>
          <div class="hint">Paste an image URL or upload a file — uploads are saved with your library
            and included in exports. Leave blank for a generated cover.</div></div>

        <div id="movie-fields" ${type === 'show' ? 'hidden' : ''}>
          <div class="field"><label>Wikipedia movie URL or page title (optional)</label>
            <input id="f-wiki" value="${esc(currentWikiTitle)}"
              placeholder="https://en.wikipedia.org/wiki/Interstellar_(film)">
            <div class="hint">Use this when movie search picks the wrong page. Open the movie's
              Wikipedia page, copy its URL, then press Auto-fill.</div></div>
          <div class="field"><label>Drive link</label>
            <input id="f-link" value="${esc(item?.link || '')}"
              placeholder="https://drive.google.com/file/d/…/view">
            <div class="hint">Share the file as “Anyone with the link” (or stay signed in to your account here).</div></div>
          <div class="field"><label>Local file (plays MKV, MP4, … with subtitles)</label>
            <div class="hero-actions" style="align-items:center">
              <button type="button" class="icon-btn" id="btn-pick-local">📁 Choose file…</button>
              <span class="hint" id="local-status" style="margin:0; word-break:break-all">${item?.localPath
                ? esc(item.localPath) : ''}</span>
              ${item?.localPath ? '<button type="button" class="icon-btn" id="btn-clear-local">✕</button>' : ''}
            </div>
            <div class="hint">Point at a file on this Mac. It plays in-app via the built-in
              player — no Drive needed. Local paths stay out of shared library.json.</div></div>
        </div>

        <div id="show-fields" ${type === 'movie' ? 'hidden' : ''}>
          <div class="field"><label>TVMaze show URL or ID (optional)</label>
            <input id="f-tvmaze" value="${esc(currentTvmazeId)}"
              placeholder="https://www.tvmaze.com/shows/123/show-name or 123">
            <div class="hint">Use this when title search picks the wrong show. Find the show on
              TVMaze, copy its page URL, then press Auto-fill / refresh.</div></div>
          <div class="field"><label>Seasons & episodes</label></div>
          <div id="season-editors">
            ${(item?.seasons?.length ? item.seasons : [{}])
              .map((s, i) => seasonEditorHtml(s, i)).join('')}
          </div>
          <button type="button" class="icon-btn" id="add-season">＋ Season</button>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">Cancel <kbd>⎋</kbd></button>
        <button type="submit" class="pill-btn accent">${item ? 'Save changes' : 'Add to library'} <kbd>⏎</kbd></button>
      </div>
    </form>
  </div>`;

  const form = $('#add-form');
  let curType = type;

  form.addEventListener('click', e => {
    const t = e.target.closest('[data-type]');
    if (t) {
      curType = t.dataset.type;
      $$('.seg button', form).forEach(b => b.classList.toggle('active', b === t));
      $('#movie-fields').hidden = curType === 'show';
      $('#show-fields').hidden = curType === 'movie';
    }
    if (e.target.closest('#add-season')) {
      const wrap = $('#season-editors');
      wrap.insertAdjacentHTML('beforeend', seasonEditorHtml({}, wrap.children.length));
    }
    if (e.target.closest('[data-add-ep]')) {
      e.target.closest('.season-editor').querySelector('.ep-editors')
        .insertAdjacentHTML('beforeend', epEditorHtml());
    }
    if (e.target.closest('[data-remove-ep]')) e.target.closest('.ep-editor').remove();
    if (e.target.closest('[data-remove-season]')) e.target.closest('.season-editor').remove();
  });

  let pendingCover = null;                             // uploaded file as data-URL
  const keepUploaded = item?.cover?.startsWith('data:') ? item.cover : null;

  // local file picker (Electron only)
  let localPath = item?.localPath || '';
  const pickBtn = $('#btn-pick-local');
  if (pickBtn) {
    if (!window.kinoir?.pickVideoFile) {
      pickBtn.disabled = true;
      pickBtn.textContent = '📁 Choose file… (desktop app only)';
    }
    pickBtn.addEventListener('click', async () => {
      const p = await window.kinoir?.pickVideoFile?.();
      if (p) { localPath = p; $('#local-status').textContent = p; }
    });
  }
  form.addEventListener('click', e => {
    if (e.target.closest('#btn-clear-local')) {
      localPath = '';
      const st = $('#local-status'); if (st) st.textContent = '';
      e.target.closest('#btn-clear-local').remove();
    }
  });

  $('#btn-upload-cover').addEventListener('click', () => $('#f-cover-file').click());
  $('#f-cover-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingCover = await coverFromFile(file);
      $('#cover-status').textContent = `${file.name} attached ✓`;
    } catch { toast('Could not read that image'); }
  });

  $('#btn-autofill').addEventListener('click', async () => {
    const q = $('#f-title').value.trim();
    const tvmazeInput = curType === 'show' ? $('#f-tvmaze').value.trim() : '';
    const exactTvmazeId = curType === 'show' ? tvmazeShowRef(tvmazeInput) : '';
    const wikiInput = curType === 'movie' ? $('#f-wiki').value.trim() : '';
    const exactWikiTitle = curType === 'movie' ? wikiPageRef(wikiInput) : '';
    if (curType === 'show' && tvmazeInput && !exactTvmazeId) {
      toast('Paste a TVMaze show URL or numeric show ID');
      $('#f-tvmaze').focus();
      return;
    }
    if (curType === 'movie' && wikiInput && !exactWikiTitle) {
      toast('Paste a Wikipedia movie URL or exact page title');
      $('#f-wiki').focus();
      return;
    }
    if (!q && !exactTvmazeId && !exactWikiTitle && !(curType === 'show' && currentTvmazeId)) {
      toast(curType === 'show'
        ? 'Type a title or paste a TVMaze show URL'
        : 'Type a title or paste a Wikipedia movie URL');
      (curType === 'show' ? $('#f-tvmaze') : $('#f-wiki')).focus();
      return;
    }
    const btn = $('#btn-autofill');
    btn.disabled = true; btn.textContent = curType === 'show'
      ? '✦ Refreshing from TVMaze…'
      : '✦ Searching the web…';
    try {
      let info = null;
      if (curType === 'show' && exactTvmazeId)
        info = await withTimeout(tvmazeShow(exactTvmazeId));
      if (curType === 'show' && !info && currentTvmazeId)
        info = await withTimeout(tvmazeShow(currentTvmazeId));
      if (curType === 'show' && !info) info = (await withTimeout(searchTVMaze(q)))[0];
      if (curType === 'movie' && exactWikiTitle)
        info = await withTimeout(wikiSummary(exactWikiTitle));
      if (!info) info = await withTimeout(wikiLookup(curType === 'movie' ? `${q} (film)` : q));
      if (!info || (!info.id && !info.summary && !info.image)) throw 0;
      if (info.id) {
        currentTvmazeId = String(info.id);
        if (curType === 'show') $('#f-tvmaze').value = currentTvmazeId;
      }
      if (info.wikiTitle) {
        currentWikiTitle = info.wikiTitle;
        if (curType === 'movie') $('#f-wiki').value = currentWikiTitle;
      }
      if (info.title && !$('#f-title').value.trim()) $('#f-title').value = info.title;
      if (info.genres?.length && !$('#f-genre').value)
        $('#f-genre').value = info.genres.slice(0, 2).join(' · ');
      if (info.summary && !$('#f-subtitle').value)
        $('#f-subtitle').value = info.summary.slice(0, 180);
      if (curType === 'show' && formatShowDates(info))
        $('#f-dates').value = formatShowDates(info);
      if (info.image && !$('#f-cover').value.trim() && !pendingCover)
        $('#f-cover').value = info.image;

      let epCount = 0;
      if (curType === 'show' && info.id) {           // fill every episode title too
        const seasons = await withTimeout(tvmazeEpisodes(info.id), 8000);
        if (seasons.length) {
          const oldCount = $$('.ep-editor', form).length;
          const keptLinks = mergeEpisodeLinks(seasons, currentEpisodeLookups(form));
          seasons.forEach(s => s.episodes.forEach(() => epCount++));
          $('#season-editors').innerHTML =
            seasons.map((s, i) => seasonEditorHtml(s, i)).join('');
          const addedCount = Math.max(0, epCount - oldCount);
          toast(`Refreshed ${epCount} episodes${addedCount ? `, added ${addedCount} new` : ''}${keptLinks ? `, kept ${keptLinks} Drive links` : ''} ✓`);
        } else {
          toast('Show details filled, but TVMaze returned no episodes yet');
        }
      } else {
        toast('Details filled from the web ✓');
      }
    } catch { toast('Nothing found — check the spelling'); }
    btn.disabled = false; btn.textContent = '✦ Auto-fill / refresh details from the web';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const coverUrl = $('#f-cover').value.trim();
    const data = {
      id: item?.id || uid(),
      type: curType,
      title: $('#f-title').value.trim(),
      genre: $('#f-genre').value.trim(),
      subtitle: $('#f-subtitle').value.trim(),
      dates: $('#f-dates').value.trim(),
      cover: pendingCover || coverUrl || keepUploaded || '',
      added: item?.added || Date.now()
    };
    if (!data.title) return;
    if (curType === 'movie') {
      data.wikiTitle = wikiPageRef($('#f-wiki').value) || currentWikiTitle || item?.wikiTitle || '';
      data.link = $('#f-link').value.trim();
      if (localPath) data.localPath = localPath;
    } else {
      data.tvmazeId = tvmazeShowRef($('#f-tvmaze').value) || currentTvmazeId || item?.tvmazeId || '';
      data.seasons = $$('.season-editor', form).map(se => ({
        name: $('.f-season-name', se).value.trim(),
        episodes: $$('.ep-editor', se).map(ee => ({
          tvmazeId: ee.dataset.tvmazeId || '',
          season: ee.dataset.season || '',
          number: ee.dataset.number || '',
          title: $('.f-ep-title', ee).value.trim(),
          airdate: $('.f-ep-airdate', ee).value.trim(),
          subtitle: $('.f-ep-sub', ee).value.trim(),
          link: $('.f-ep-link', ee).value.trim(),
          localPath: ee.dataset.localPath || ''
        })).filter(ep => ep.title || ep.link || ep.localPath)
      })).filter(s => s.episodes.length);
    }
    if (item) state.library = state.library.map(i => i.id === item.id ? data : i);
    else state.library.unshift(data);

    saveLibrary();
    closeModal();
    toast(item ? 'Saved ✓' : `Added “${data.title}” ✓`);
    render();
  });

  $('#f-title').focus();
}

/* ---------- Settings ---------- */
export function openSettings() {
  const originalTheme = state.settings.theme || 'graphite';
  let previewTheme = originalTheme;
  let themeCommitted = false;
  onModalClose = () => { if (!themeCommitted) applyTheme(originalTheme); };
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass" id="settings-form">
      <div class="modal-head"><h2>Settings</h2></div>
      <div class="modal-body">
        <div class="field"><label>Appearance</label>
          <div class="theme-grid" id="theme-grid" role="radiogroup" aria-label="App theme">
            ${THEMES.map(theme => `<button type="button" class="theme-choice ${theme.id === originalTheme ? 'active' : ''}"
              data-theme-choice="${theme.id}" role="radio" aria-checked="${theme.id === originalTheme}">
              <span class="theme-swatch" aria-hidden="true">
                ${theme.colors.map(color => `<i style="--swatch:${color}"></i>`).join('')}
              </span>
              <span class="theme-copy"><b>${theme.name}</b><small>${theme.description}</small></span>
              <span class="theme-check" aria-hidden="true">✓</span>
            </button>`).join('')}
          </div>
          <div class="hint">Choose a theme to preview it instantly. System follows your Mac's light or dark appearance.</div></div>
        <div class="field"><label>Optional components</label>
          <div id="component-list" class="component-list" aria-live="polite">
            <div class="component-loading">Checking installed components…</div>
          </div>
          <div class="component-actions">
            <button type="button" class="pill-btn small" id="btn-components-refresh">⟳ Check again</button>
          </div>
          <div class="hint">Kinoir uses copies already installed on this Mac. Optional tools are
            kept outside the core app so updates remain small.</div></div>
        <div class="field"><label>AI Concierge model (runs locally via Ollama)</label>
          <select id="f-model">
            <option value="${esc(state.settings.model)}" selected>${esc(state.settings.model)}</option>
          </select>
          <div class="component-actions">
            <button type="button" class="pill-btn small" id="btn-model-install" hidden>Download selected model</button>
          </div>
          <div class="hint">Any model you've pulled with <code>ollama pull</code> appears here.
            Default is <b>llama3.2</b>. Downloads can be several gigabytes; Kinoir only starts
            one after you press the button. No API account is required.</div></div>
        <div class="field"><label>Concierge</label>
          <label class="check-row"><input type="checkbox" id="f-outside"
            ${state.settings.allowOutsideSuggestions ? 'checked' : ''}> Allow outside suggestions when I turn them on
            <span class="hint" style="margin:0">(top ◎ icon — outside titles are not playable cards)</span></label>
          <label class="check-row"><input type="checkbox" id="f-use-brave"
            ${state.settings.useBraveSearch ? 'checked' : ''}> Yes, use Brave Search when I ask for web context</label>
          <input id="f-brave" type="password" value=""
            placeholder="Paste a new Brave Search API key" style="margin-top:8px" autocomplete="off">
          <div class="component-actions">
            <span class="hint" id="brave-key-status">Checking encrypted key…</span>
            <button type="button" class="pill-btn small" id="btn-brave-remove" hidden>Remove saved key</button>
          </div>
          <div class="hint">With ⌂ Library active, recommendations stay inside your saved titles.
            With ◎ Outside active, no Brave key means the model uses its own film/TV knowledge;
            with a Brave key, it can add search context.</div></div>
        <div class="field"><label>Behaviour</label>
          <label class="check-row"><input type="checkbox" id="f-group"
            ${state.settings.groupByGenre ? 'checked' : ''}> Group home rows by genre automatically</label>
          <label class="check-row"><input type="checkbox" id="f-always-pip"
            ${state.settings.alwaysPip ? 'checked' : ''}> Always play local videos in Picture-in-Picture mode</label>
          <label class="check-row"><input type="checkbox" id="f-reduce-effects"
            ${state.settings.reduceEffects ? 'checked' : ''}> Reduce blur, animation, and automatic video previews
            <span class="hint" style="margin:0">Recommended for older Macs or very large libraries.</span></label></div>
        <div class="field"><label>Local media — auto-classify your files</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn accent" id="btn-scan">⟳ Scan media folders</button>
            <button type="button" class="pill-btn" id="btn-add-root">＋ Add folder</button>
          </div>
          <div id="media-roots" class="media-roots"></div>
          <div class="hint">Drop movies/shows into the app's <b>Media/</b> folder, or add any
            folder on your Mac. Scanning reads the names, matches TVMaze / Wikipedia, and adds
            them — asking you to confirm anything it can't identify. Local paths stay out of
            shared library.json.</div></div>
        <div class="field"><label>Continue Watching</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn danger" id="btn-clear-watch"
              ${state.watchLog.length ? '' : 'disabled'}>Clear Continue Watching</button>
          </div>
          <div class="hint">${state.watchLog.length
            ? `This removes ${state.watchLog.length} saved progress entr${state.watchLog.length === 1 ? 'y' : 'ies'} from this browser.`
            : 'There is nothing in Continue Watching right now.'}</div></div>
        <div class="field"><label>Kinoir Air (Local Network Streaming)</label>
          <label class="check-row"><input type="checkbox" id="f-air-enabled" disabled>
            Enable paired access on this Wi-Fi network</label>
          <div class="air-share-row">
            <div id="air-qr" class="air-qr">
              <span class="hint">Checking…</span>
            </div>
            <div class="air-share-copy">
              <div id="air-url" class="air-url">Checking network…</div>
              <button type="button" class="pill-btn small" id="btn-air-copy" hidden>Copy pairing link</button>
              <div class="hint">Air is off by default. When enabled, only devices entering through
                this rotating pairing link can browse and stream. Paired devices cannot edit,
                scan, generate subtitles, or change your library.</div>
            </div>
          </div>
        </div>
        <div class="field"><label>Library folder — share it via Drive</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn" id="btn-folder-reload">⟳ Reload from folder</button>
            <button type="button" class="pill-btn" id="btn-export">⇩ Export library.json</button>
            <button type="button" class="pill-btn" id="btn-export-watch">⇩ Export watch.json</button>
            <button type="button" class="pill-btn" id="btn-import">⇧ Import file</button>
          </div>
          <div class="hint">Drop <b>library.json</b> (titles &amp; covers) in the app's <b>library/</b>
            folder and share that folder — e.g. synced via Drive. <b>watch.json</b> holds your
            personal watch history / continue-watching; it's a separate file so sharing it is optional.
            Reload picks up both.</div></div>
        <div class="field"><label>Updates</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn" id="btn-check-updates">Check for updates</button>
            <button type="button" class="pill-btn" id="btn-open-release" hidden>Open release page</button>
          </div>
          <div class="hint" id="update-status">Checks GitHub only when you press the button. Automatic background checks are off.</div></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">Cancel <kbd>⎋</kbd></button>
        <button type="submit" class="pill-btn accent">Save <kbd>⏎</kbd></button>
      </div>
    </form>
  </div>`;

  $('#theme-grid').addEventListener('click', e => {
    const choice = e.target.closest('[data-theme-choice]');
    if (!choice) return;
    previewTheme = applyTheme(choice.dataset.themeChoice);
    $$('[data-theme-choice]', $('#theme-grid')).forEach(button => {
      const selected = button.dataset.themeChoice === previewTheme;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-checked', String(selected));
    });
  });

  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const braveKey = $('#f-brave').value.trim();
    const wantsBrave = $('#f-use-brave').checked;
    let braveKeyConfigured = Boolean(state.settings.braveKeyConfigured || state.settings.braveKey);
    if (braveKey && window.kinoir?.setBraveKey) {
      const stored = await window.kinoir.setBraveKey(braveKey);
      if (!stored?.ok) { toast(stored?.error || 'Could not save the Brave key'); return; }
      braveKeyConfigured = Boolean(stored.configured);
    }
    state.settings = { ...state.settings, model: $('#f-model').value,
      theme: previewTheme,
      braveKey: window.kinoir?.setBraveKey ? '' : braveKey,
      braveKeyConfigured,
      allowOutsideSuggestions: $('#f-outside').checked,
      useBraveSearch: wantsBrave && braveKeyConfigured,
      groundToLibrary: true,
      alwaysPip: $('#f-always-pip').checked,
      reduceEffects: $('#f-reduce-effects').checked,
      groupByGenre: $('#f-group').checked };
    themeCommitted = true;
    applyTheme(previewTheme);
    document.body.classList.toggle('reduce-effects', Boolean(state.settings.reduceEffects));
    if (!state.settings.reduceEffects) startPreviewWorker();
    saveSettings();
    syncSuggestionScopeUi();
    closeModal();
    toast(wantsBrave && !braveKeyConfigured
      ? 'Settings saved — Brave Search is off until you add a key'
      : 'Settings saved ✓');
    render();
  });

  // ---- optional desktop components ----
  const componentMeta = {
    ollama: { name: 'Local AI', icon: '✦', dependency: 'Ollama' },
    iina: { name: 'Native playback', icon: '▶', dependency: 'IINA' },
    whisper: { name: 'Local subtitles', icon: 'CC', dependency: 'Whisper' }
  };
  const renderComponents = components => {
    const box = $('#component-list');
    if (!box) return;
    box.innerHTML = Object.entries(componentMeta).map(([key, meta]) => {
      const item = components?.[key] || { state: 'missing', detail: 'Status unavailable' };
      const label = { ready: 'Ready', installed: 'Installed', starting: 'Starting…', missing: 'Not installed' }[item.state] || 'Unavailable';
      const action = key === 'ollama' && item.state === 'installed'
        ? `<button type="button" class="pill-btn small" data-component-start="ollama">Start</button>`
        : item.state === 'missing'
          ? `<button type="button" class="pill-btn small" data-component-page="${key}">Set up</button>`
          : '';
      return `<div class="component-row">
        <div class="component-icon">${meta.icon}</div>
        <div class="component-copy"><b>${meta.name}</b><span>${meta.dependency} · ${esc(item.detail || '')}${item.source ? ` · ${esc(item.source)}` : ''}</span></div>
        <span class="component-badge ${esc(item.state)}">${label}</span>${action}
      </div>`;
    }).join('');
  };
  const refreshComponents = async () => {
    const box = $('#component-list');
    if (!window.kinoir?.getComponentStatus) {
      if (box) box.innerHTML = '<div class="component-loading">Component setup is available in the desktop app.</div>';
      return;
    }
    if (box) box.classList.add('checking');
    try { renderComponents(await window.kinoir.getComponentStatus()); }
    catch { if (box) box.innerHTML = '<div class="component-loading">Could not check components.</div>'; }
    finally { box?.classList.remove('checking'); }
  };
  $('#btn-components-refresh').addEventListener('click', refreshComponents);
  $('#component-list').addEventListener('click', async e => {
    const page = e.target.closest('[data-component-page]');
    if (page) {
      await window.kinoir?.openComponentPage?.(page.dataset.componentPage);
      toast('Install it, then return here and press Check again');
      return;
    }
    const start = e.target.closest('[data-component-start]');
    if (start) {
      start.disabled = true;
      start.textContent = 'Starting…';
      const result = await window.kinoir?.startOllama?.();
      if (result?.components) renderComponents(result.components);
      else await refreshComponents();
      toast(result?.ok ? 'Local AI is ready' : 'Ollama could not be started');
    }
  });
  void refreshComponents();

  const refreshSecretStatus = async () => {
    const status = $('#brave-key-status');
    const remove = $('#btn-brave-remove');
    if (!window.kinoir?.getSecretStatus) {
      if (status) status.textContent = state.settings.braveKey ? 'Key stored for browser development' : 'No key saved';
      return;
    }
    const secrets = await window.kinoir.getSecretStatus().catch(() => ({}));
    state.settings.braveKeyConfigured = Boolean(secrets.braveKey);
    if (status) status.textContent = secrets.braveKey ? 'Encrypted key saved in macOS storage' : 'No key saved';
    if (remove) remove.hidden = !secrets.braveKey;
  };
  $('#btn-brave-remove').addEventListener('click', async () => {
    const result = await window.kinoir?.setBraveKey?.('');
    if (!result?.ok) { toast(result?.error || 'Could not remove the key'); return; }
    state.settings.braveKeyConfigured = false;
    state.settings.useBraveSearch = false;
    saveSettings();
    $('#f-use-brave').checked = false;
    await refreshSecretStatus();
    toast('Saved Brave key removed');
  });
  void refreshSecretStatus();

  $('#btn-folder-reload').addEventListener('click', async () => {
    if (await loadFromFolder(false)) closeModal();
  });
  $('#btn-clear-watch').addEventListener('click', () => {
    if (!state.watchLog.length) return;
    if (!confirm('Clear everything from Continue Watching? Your library titles will stay saved.')) return;
    removeFromContinueWatching();
    closeModal();
    render();
    toast('Continue Watching cleared');
  });
  const download = (name, obj) => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)],
        { type: 'application/json' })),
      download: name });
    a.click();
  };
  $('#btn-export').addEventListener('click', () => {
    download('library.json', { library: state.library });
    toast('Downloaded — move it into the app\'s library/ folder');
  });
  $('#btn-export-watch').addEventListener('click', () => {
    download('watch.json', { watchLog: state.watchLog });
    toast('watch.json downloaded — sharing it is optional');
  });
  $('#btn-import').addEventListener('click', importLibraryFile);
  let releaseUrl = '';
  $('#btn-check-updates').addEventListener('click', async event => {
    if (!window.kinoir?.checkForUpdates) { toast('Update checks need the desktop app'); return; }
    event.target.disabled = true;
    $('#update-status').textContent = 'Checking GitHub releases…';
    const result = await window.kinoir.checkForUpdates();
    event.target.disabled = false;
    if (!result?.ok) {
      $('#update-status').textContent = `Could not check: ${result?.error || 'unknown error'}`;
      return;
    }
    releaseUrl = result.url || '';
    $('#btn-open-release').hidden = !releaseUrl;
    $('#update-status').textContent = result.updateAvailable
      ? `Version ${result.latestVersion} is available. You have ${result.currentVersion}.`
      : result.noReleases ? `Version ${result.currentVersion} — no public releases yet.`
        : `Kinoir ${result.currentVersion} is up to date.`;
  });
  $('#btn-open-release').addEventListener('click', () =>
    window.kinoir?.openReleasePage?.(releaseUrl));

  // ---- local media folders ----
  const renderRoots = () => {
    const box = $('#media-roots');
    const roots = state.settings.mediaRoots || [];
    box.innerHTML = `<div class="root-chip default">📁 Media/ (in the app)</div>` +
      roots.map((r, i) => `<div class="root-chip">📁 ${esc(r)}
        <button type="button" class="root-x" data-remove-root="${i}" title="Remove">✕</button></div>`).join('');
  };
  renderRoots();
  $('#media-roots').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove-root]');
    if (rm) {
      state.settings.mediaRoots.splice(+rm.dataset.removeRoot, 1);
      saveSettings(); renderRoots();
    }
  });
  $('#btn-add-root').addEventListener('click', async () => {
    if (!window.kinoir?.pickFolder) { toast('Adding folders needs the desktop app'); return; }
    const dir = await window.kinoir.pickFolder();
    if (!dir) return;
    state.settings.mediaRoots = state.settings.mediaRoots || [];
    if (!state.settings.mediaRoots.includes(dir)) {
      state.settings.mediaRoots.push(dir);
      saveSettings(); renderRoots();
      toast('Folder added — press Scan');
    }
  });
  $('#btn-scan').addEventListener('click', () => openScanFlow());

  // populate the model picker with whatever Ollama models are installed
  (async () => {
    try {
      const r = await fetch('/api/models');
      const d = await r.json();
      const models = d.models || [];
      const sel = $('#f-model');
      const install = $('#btn-model-install');
      if (!sel) return;
      const norm = s => String(s).replace(/:latest$/, '');   // llama3.2 == llama3.2:latest
      const cur = state.settings.model;
      if (models.length) sel.innerHTML = models.map(m =>
        `<option value="${esc(m)}" ${norm(m) === norm(cur) ? 'selected' : ''}>${esc(m)}</option>`).join('');
      else sel.innerHTML = `<option value="${esc(cur)}" selected>${esc(cur)} — not installed (ollama pull)</option>`;
      if (models.length && !models.some(m => norm(m) === norm(cur)))
        sel.insertAdjacentHTML('afterbegin',
          `<option value="${esc(cur)}" selected>${esc(cur)} — not installed (ollama pull)</option>`);
      if (install) install.hidden = models.some(m => norm(m) === norm(cur));
    } catch { /* Ollama not reachable — keep the single fallback option */ }
  })();
  $('#f-model').addEventListener('change', () => {
    const button = $('#btn-model-install');
    if (button) button.hidden = !$('#f-model').selectedOptions[0]?.textContent.includes('not installed');
  });
  $('#btn-model-install').addEventListener('click', async event => {
    if (!window.kinoir?.pullOllamaModel) { toast('Model setup needs the desktop app'); return; }
    const model = $('#f-model').value;
    event.target.disabled = true;
    event.target.textContent = `Downloading ${model}…`;
    const result = await window.kinoir.pullOllamaModel(model).catch(error =>
      ({ ok: false, error: String(error.message || error) }));
    if (result?.ok) {
      event.target.hidden = true;
      toast(`${model} is ready`);
      await refreshComponents();
    } else {
      event.target.disabled = false;
      event.target.textContent = 'Try download again';
      toast(result?.error || 'Model download failed');
    }
  });

  // Kinoir Air is managed by Electron so LAN access remains opt-in and paired.
  let currentAirStatus = null;
  const renderAirStatus = async status => {
    currentAirStatus = status;
    const toggle = $('#f-air-enabled');
    const qr = $('#air-qr');
    const label = $('#air-url');
    const copy = $('#btn-air-copy');
    if (!toggle || !qr || !label || !copy) return;
    toggle.disabled = false;
    toggle.checked = Boolean(status?.enabled);
    copy.hidden = !status?.pairUrl;
    if (!status?.available) {
      label.textContent = 'Not connected to a local network';
      qr.innerHTML = '<span class="hint">Offline</span>';
      return;
    }
    if (!status.enabled || !status.pairUrl) {
      label.textContent = 'Air is off';
      qr.innerHTML = '<span class="air-lock" aria-hidden="true">⌁</span>';
      return;
    }
    label.textContent = status.url;
    try {
      const response = await fetch(`/api/qr?text=${encodeURIComponent(status.pairUrl)}`);
      if (!response.ok) throw new Error('QR unavailable');
      qr.innerHTML = await response.text();
      const svg = qr.querySelector('svg');
      if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; }
    } catch {
      qr.innerHTML = '<span class="hint">QR unavailable</span>';
    }
  };
  (async () => {
    if (!window.kinoir?.getAirStatus) {
      $('#air-url').textContent = 'Air controls are available in the desktop app';
      $('#air-qr').innerHTML = '<span class="hint">Desktop only</span>';
      return;
    }
    try { await renderAirStatus(await window.kinoir.getAirStatus()); }
    catch { $('#air-url').textContent = 'Could not check Air status'; }
  })();
  $('#f-air-enabled').addEventListener('change', async event => {
    event.target.disabled = true;
    try {
      await renderAirStatus(await window.kinoir.setAirEnabled(event.target.checked));
      toast(event.target.checked ? 'Kinoir Air enabled — pairing code ready' : 'Kinoir Air disabled');
    } catch {
      event.target.checked = !event.target.checked;
      toast('Could not change Kinoir Air');
    } finally { event.target.disabled = false; }
  });
  $('#btn-air-copy').addEventListener('click', async () => {
    if (!currentAirStatus?.pairUrl) return;
    await navigator.clipboard.writeText(currentAirStatus.pairUrl);
    toast('Pairing link copied');
  });

  $('#f-model').focus();
}

/* ---------------- Library folder (share it via Drive) ---------------- */
export async function loadFromFolder(silent) {
  try {
    const r = await fetch('library/library.json', { cache: 'no-store' });
    if (!r.ok) throw 0;
    const data = await r.json();
    if (!Array.isArray(data.library)) throw 0;
    state.library = data.library;
    saveLibrary();
    await loadPreviewManifest();
    try {   // watch history is a separate, optional file — personal by default
      const w = await fetch('library/watch.json', { cache: 'no-store' });
      if (w.ok) {
        const wd = await w.json();
        if (Array.isArray(wd.watchLog)) { state.watchLog = wd.watchLog; store.set('watchLog', state.watchLog); }
      }
    } catch { /* no watch.json — keep local history */ }
    render();
    if (!silent) toast(`Loaded ${state.library.length} title${state.library.length === 1 ? '' : 's'} from library folder ✓`);
    return true;
  } catch {
    if (!silent) toast('No library/library.json found next to the app');
    return false;
  }
}

export function importLibraryFile() {
  const inp = Object.assign(document.createElement('input'),
    { type: 'file', accept: '.json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      let got = false;
      if (Array.isArray(data.library)) { state.library = data.library; saveLibrary(); got = true; }
      if (Array.isArray(data.watchLog)) { state.watchLog = data.watchLog; store.set('watchLog', state.watchLog); got = true; }
      if (!got) throw 0;
      closeModal();
      render();
      toast('Imported ✓');
    } catch { toast('Could not read that file'); }
  };
  inp.click();
}
