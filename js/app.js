/* ================= Linkflix — entry point =================
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

import { state, saveLibrary, isAirClient } from './state.js';
import { $ } from './dom.js';
import { render, playItem } from './views.js';
import { openAddModal, openSettings, loadFromFolder, importLibraryFile, closeModal } from './modals.js';
import {
  toggleChat, refreshConciergeContext, setOutsideSuggestions,
  sendChat, syncSuggestionScopeUi
} from './concierge.js';
import { focusFirst } from './nav.js';
import { startSemanticWorker, rankLibrary } from './semantic.js';
import { loadPreviewManifest, startPreviewWorker } from './previews.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { startLocalAvailabilityMonitor } from './local-media.js';
import './hover.js';               // side-effect: hover-preview listeners

applyTheme(state.settings.theme);
watchSystemTheme(() => state.settings.theme);

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
let searchRevision = 0;

function resetSearchAndGoHome() {
  clearTimeout(searchTimer);
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
  
  const focused = document.activeElement;
  render();
  if (focused) focused.focus();

  clearTimeout(searchTimer);
  if (q.split(' ').length > 1 || q.length > 5) {
    searchTimer = setTimeout(async () => {
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

// Background semantic indexing (not on Air viewers — phones shouldn't build embeddings).
// Previews start first so a title opened immediately can begin preparing its teaser.
if (!isAirClient) {
  startPreviewWorker();
  setTimeout(() => startSemanticWorker(), 2000);
}
