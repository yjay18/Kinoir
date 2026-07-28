/* ================= Kinoir — entry point =================
   The app is split into focused ES modules:
     dom        — DOM helpers ($, $$, esc, toast)
     state      — shared mutable state + localStorage/disk persistence
     drive      — Drive link parsing
     covers     — image upload + generated cover art
     format     — date / meta formatting
     taxonomy   — genre/category/tag intelligence, playability
     metadata   — TVMaze / Wikipedia / Brave web lookups
     views      — rendering, home/detail/player, hero, playback nav
     modals     — add / edit / settings / folder import-export
     concierge  — local WebLLM chat + grounded recommendations
     nav        — keyboard navigation (self-wires keydown)
     hover      — Netflix-style hover previews (self-wires listeners)
   This file only wires the persistent top-bar / chat controls and boots. */

import { state, saveLibrary, saveSettings, isAirClient } from './state.js';
import { $ } from './dom.js';
import { render, playItem } from './views.js';
import { openAddModal, openSettings, openWelcome, loadFromFolder, importLibraryFile, closeModal } from './modals.js';
import {
  toggleChat, refreshConciergeContext, setOutsideSuggestions,
  sendChat, syncSuggestionScopeUi
} from './concierge.js';
import { focusFirst } from './nav.js';
import { loadPreviewManifest, startPreviewWorker } from './previews.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { startLocalAvailabilityMonitor } from './local-media.js';
import './hover.js';               // side-effect: hover-preview listeners

applyTheme(state.settings.theme);
watchSystemTheme(() => state.settings.theme);
document.body.classList.toggle('air-client', isAirClient);
document.body.classList.toggle('reduce-effects', Boolean(state.settings.reduceEffects));

// One-time migration from older renderer-local API-key storage to Electron's
// encrypted preferences store.
if (window.kinoir?.setBraveKey && state.settings.braveKey) {
  const legacyKey = state.settings.braveKey;
  void window.kinoir.setBraveKey(legacyKey).then(result => {
    if (result?.ok) delete state.settings.braveKey;
    state.settings.braveKeyConfigured = Boolean(result?.ok && result.configured);
    state.settings.useBraveSearch = Boolean(state.settings.useBraveSearch &&
      state.settings.braveKeyConfigured);
    saveSettings();
    syncSuggestionScopeUi();
  });
}

let semanticModulePromise = null;
const semanticModule = () => semanticModulePromise ||= import('./semantic.js');

// Template media uses delegated listeners so a strict Content Security Policy
// can stay enabled without inline event-handler attributes.
document.addEventListener('error', event => {
  const media = event.target;
  if (media instanceof HTMLElement && media.matches('[data-remove-on-error]')) media.remove();
}, true);
document.addEventListener('playing', event => {
  const media = event.target;
  if (!(media instanceof HTMLElement) || !media.matches('[data-preview-reveal]')) return;
  media.classList.add('on');
  if (media.matches('[data-dim-next]')) media.nextElementSibling?.classList.add('off');
}, true);

const modalBackground = [document.querySelector('header'), $('#view'), $('#chat-panel'),
  document.querySelector('footer')].filter(Boolean);
new MutationObserver(() => {
  const open = Boolean($('#modal-root').firstElementChild);
  document.body.classList.toggle('modal-open', open);
  modalBackground.forEach(element => { element.inert = open; });
}).observe($('#modal-root'), { childList: true });

/* ---------- persistent controls ---------- */
$('#brand').addEventListener('click', () => resetSearchAndGoHome());
$('#btn-add').addEventListener('click', () => openAddModal());
$('#btn-chat').addEventListener('click', () => toggleChat());
$('#btn-scope').addEventListener('click', () =>
  setOutsideSuggestions(!state.settings.allowOutsideSuggestions));
$('#btn-settings').addEventListener('click', () => openSettings());
$('#chat-close').addEventListener('click', () => toggleChat(false));
$('#chat-refresh').addEventListener('click', () => refreshConciergeContext(true));
$('#chat-scope-library').addEventListener('click', () => setOutsideSuggestions(false));
$('#chat-scope-outside').addEventListener('click', () => setOutsideSuggestions(true));

$('#chat-messages').addEventListener('click', e => {
  const card = e.target.closest('[data-chat-play]');
  if (card) { toggleChat(false); playItem(card.dataset.chatPlay); }
});

$('#chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendChat(text);
});

let searchTimer;
let keywordRenderTimer;
let searchRevision = 0;

function resetSearchAndGoHome() {
  clearTimeout(searchTimer);
  clearTimeout(keywordRenderTimer);
  searchRevision += 1;
  $('#search-input').value = '';
  state.searchQuery = '';
  state.semanticResults = null;
  state.view = { name: 'home' };
  render();
}

$('#search-input').addEventListener('input', e => {
  const q = e.target.value.trim();
  const revision = ++searchRevision;
  state.searchQuery = q;
  state.semanticResults = null;
  if (state.view.name !== 'home') state.view = { name: 'home' };

  clearTimeout(keywordRenderTimer);
  keywordRenderTimer = setTimeout(() => render(), 70);

  clearTimeout(searchTimer);
  if (q.split(' ').length > 1 || q.length > 5) {
    searchTimer = setTimeout(async () => {
      const { rankLibrary } = await semanticModule();
      const results = await rankLibrary(q);
      if (revision !== searchRevision || state.searchQuery !== q) return;
      state.semanticResults = results;
      const active = document.activeElement;
      render();
      if (active) active.focus();
    }, 400);
  }
});
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusFirst(); }
});

$('#modal-root').addEventListener('click', e => {
  if (e.target.dataset.overlay !== undefined && e.target === e.currentTarget.firstElementChild)
    closeModal();
  if (e.target.closest('[data-action="close-modal"]')) closeModal();
});

/* ---------- boot ---------- */
// clean up demo entries left over from earlier versions
const isDemoLink = s => String(s || '').includes('1DemoFileIdReplaceMe123');
const cleaned = state.library.filter(i => !(i.demo || isDemoLink(i.link) ||
  (i.seasons || []).some(se => (se.episodes || []).some(ep => isDemoLink(ep.link)))));
if (cleaned.length !== state.library.length) { state.library = cleaned; saveLibrary(); }

syncSuggestionScopeUi();
render();
startLocalAvailabilityMonitor();
loadPreviewManifest().then(() => render());
if (isAirClient) loadFromFolder(true);             // Air viewer: the Mac's library is the truth
else if (!state.library.length) loadFromFolder(true);   // pick up a shared library/ folder if present
else saveLibrary();                                // recreate/update library/library.json on launch
if (!isAirClient && state.settings.onboardingVersion !== 1)
  setTimeout(() => openWelcome(), 450);

// Background semantic indexing (not on Air viewers — phones shouldn't build embeddings).
// Previews start first so a title opened immediately can begin preparing its teaser.
if (!isAirClient) {
  if (!state.settings.reduceEffects) startPreviewWorker();
  // Parse the sizeable semantic-search runtime only after the initial interface
  // has settled, then let the browser choose an idle period for indexing.
  setTimeout(() => {
    const begin = () => semanticModule().then(({ startSemanticWorker }) => startSemanticWorker())
      .catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 30000 });
    else setTimeout(begin, 2000);
  }, 8000);
}
