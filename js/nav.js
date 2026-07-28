/* ================= Keyboard navigation ================= */
import { $, $$ } from './dom.js';
import { state, isAirClient } from './state.js';
import { render, goBack } from './views.js';
import { openAddModal, openSettings, modalOpen, closeModal } from './modals.js';
import { toggleChat } from './concierge.js';

export function focusFirst() {
  if ($('#modal-root').firstElementChild || !$('#chat-panel').hidden) return;
  const el = $('#view .focusable');
  if (el) el.focus({ preventScroll: false });
}

function moveFocus(dx, dy) {
  const rows = $$('#view [data-navrow]')
    .map(r => $$('.focusable', r)).filter(r => r.length);
  if (!rows.length) return;
  let ri = rows.findIndex(r => r.includes(document.activeElement));
  let ci = ri >= 0 ? rows[ri].indexOf(document.activeElement) : 0;
  if (ri < 0) { rows[0][0].focus(); return; }
  if (dy) ri = Math.min(rows.length - 1, Math.max(0, ri + dy));
  if (dx) ci = Math.min(rows[ri].length - 1, Math.max(0, ci + dx));
  ci = Math.min(ci, rows[ri].length - 1);
  const target = rows[ri][ci];
  target.focus();
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function isTyping(e) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
}

document.addEventListener('keydown', e => {
  // Escape works everywhere
  if (e.key === 'Escape') {
    if (modalOpen()) { closeModal(); return; }
    if (!$('#chat-panel').hidden) { toggleChat(false); return; }
    if (isTyping(e)) { e.target.blur(); focusFirst(); return; }
    if (state.view.name !== 'home') { goBack(); return; }
    return;
  }
  if (modalOpen()) return;                    // native Tab/Enter inside modals
  if (isTyping(e)) return;                    // don't hijack typing

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); moveFocus(-1, 0); break;
    case 'ArrowRight': e.preventDefault(); moveFocus(1, 0);  break;
    case 'ArrowUp':    e.preventDefault(); moveFocus(0, -1); break;
    case 'ArrowDown':  e.preventDefault(); moveFocus(0, 1);  break;
    case 'Backspace':  if (state.view.name !== 'home') goBack(); break;
    case '/': e.preventDefault(); $('#search-input').focus(); break;
    case 'a': case 'A': if (!isAirClient) openAddModal(); break;
    case 'c': case 'C': toggleChat(); break;
    case 's': case 'S': if (!isAirClient) openSettings(); break;
    case 'h': case 'H': state.view = { name: 'home' }; render(); break;
    case 'e': case 'E': if (!isAirClient && state.view.name === 'detail') openAddModal(state.view.id); break;
  }
});
