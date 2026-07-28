/* ================= Hover preview (Netflix-style expand) ================= */
import { $, esc } from './dom.js';
import { state } from './state.js';
import { coverSrc, gradientFor } from './covers.js';
import { formatDate } from './format.js';
import { playItem, playEpisode, render } from './views.js';
import { hasPreview, invalidatePreview, previewUrl, requestPreview } from './previews.js';

const pop = document.createElement('div');
pop.id = 'hover-pop';
pop.className = 'glass';
pop.hidden = true;
document.body.appendChild(pop);
let popCardId = null, popShowTimer = null, popHideTimer = null;

function popEpisodeList(item) {
  if (item.type !== 'show') return '';
  const eps = [];
  (item.seasons || []).forEach((se, si) => (se.episodes || []).forEach((ep, ei) =>
    eps.push({
      si,
      ei,
      label: `S${si + 1} E${ei + 1}`,
      title: ep.title || `Episode ${ei + 1}`,
      airdate: ep.airdate || ''
    })));
  if (!eps.length) return '';
  return `<div class="pop-eps">${eps.map(e =>
    `<button class="pop-ep" data-pop-ep data-s="${e.si}" data-e="${e.ei}">
      <span class="pop-ep-num">${e.label}</span>${esc(e.title)}
      ${e.airdate ? `<span class="pop-ep-date">${esc(formatDate(e.airdate))}</span>` : ''}</button>`).join('')}</div>`;
}

function showPop(card) {
  if (!card?.isConnected || state.view.name !== 'home') return;
  const id = card.dataset.open;
  const item = state.library.find(i => i.id === id);
  if (!item) return;
  popCardId = id;
  const src = coverSrc(item);
  const resume = state.watchLog.some(w => w.itemId === id);
  pop.innerHTML = `
    <div class="pop-cover" style="background:${gradientFor(item.title)}">
      ${src ? `<img src="${esc(src)}" alt="" data-remove-on-error>` : ''}
      <div class="cover-fallback">${esc((item.title || '?')[0].toUpperCase())}</div>
      ${!state.settings.reduceEffects && hasPreview(id) ? `<video class="pop-teaser" src="${previewUrl(id)}"
        autoplay loop playsinline data-preview-reveal></video>` : ''}
    </div>
    <div class="pop-body">
      <div class="pop-title">${esc(item.title)}</div>
      ${item.subtitle ? `<div class="pop-sub">${esc(item.subtitle)}</div>` : ''}
      <div class="pop-actions">
        <button class="pill-btn accent small" data-pop-play>${resume ? 'Resume' : 'Play'}</button>
        <button class="pill-btn small" data-pop-details>Details</button>
      </div>
      ${popEpisodeList(item)}
    </div>`;
  const r = card.getBoundingClientRect();
  const w = 320;
  pop.style.width = w + 'px';
  pop.style.left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 12)) + 'px';
  pop.style.top = Math.max(84, r.top - 46) + 'px';
  pop.hidden = false;
  const teaser = $('.pop-teaser', pop);
  if (teaser) teaser.addEventListener('error', () => {
    invalidatePreview(id);
    teaser.remove();
    requestPreview(item, { opportunistic: true }).then(ok => {
      if (ok && popCardId === id && card.isConnected) showPop(card);
    });
  }, { once: true });
  else if (!state.settings.reduceEffects) requestPreview(item, { opportunistic: true }).then(ok => {
    if (ok && popCardId === id && card.isConnected) showPop(card);
  });
  requestAnimationFrame(() => {           // keep it on screen
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > innerHeight - 12)
      pop.style.top = Math.max(84, innerHeight - 12 - pr.height) + 'px';
  });
}

export function hidePop() {
  clearTimeout(popShowTimer);
  clearTimeout(popHideTimer);
  popShowTimer = null;
  popHideTimer = null;
  const teaser = $('.pop-teaser', pop);
  if (teaser) { teaser.pause(); teaser.removeAttribute('src'); }
  pop.replaceChildren();
  pop.hidden = true;
  popCardId = null;
}

$('#view').addEventListener('mouseover', e => {
  const card = e.target.closest('.card[data-open]');
  if (!card) return;
  clearTimeout(popHideTimer);
  if (card.dataset.open === popCardId && !pop.hidden) return;
  clearTimeout(popShowTimer);
  popShowTimer = setTimeout(() => showPop(card), 750);   // dwell before the preview opens
});
$('#view').addEventListener('mouseout', e => {
  const card = e.target.closest('.card[data-open]');
  if (!card) return;
  if (e.relatedTarget && (pop.contains(e.relatedTarget) || card.contains(e.relatedTarget))) return;
  clearTimeout(popShowTimer);
  popHideTimer = setTimeout(hidePop, 200);
});
pop.addEventListener('mouseenter', () => clearTimeout(popHideTimer));
pop.addEventListener('mouseleave', () => { popHideTimer = setTimeout(hidePop, 200); });
pop.addEventListener('click', e => {
  const id = popCardId;
  if (!id) return;
  const ep = e.target.closest('[data-pop-ep]');
  if (e.target.closest('[data-pop-play]')) { hidePop(); playItem(id); }
  else if (e.target.closest('[data-pop-details]')) { hidePop(); state.view = { name: 'detail', id }; render(); }
  else if (ep) { hidePop(); playEpisode(id, +ep.dataset.s, +ep.dataset.e); }
});
window.addEventListener('scroll', hidePop, { passive: true });
window.addEventListener('blur', hidePop);
document.addEventListener('visibilitychange', () => { if (document.hidden) hidePop(); });
