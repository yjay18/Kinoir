/* ================= Covers & visual helpers ================= */
import { esc } from './dom.js';
import { hasLocalDownload, hasMissingLocalMedia } from './local-media.js';
import { driveFileId } from './drive.js';

/* --- Covers (data-URLs stored right in the library JSON) --- */
export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// Covers display at roughly 176×264. Normalising large uploads prevents a few
// phone photos from bloating localStorage and every repeated card in the DOM.
export async function coverFromFile(file) {
  if (file.size <= 120 * 1024) return fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/webp', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('bad image')); };
    img.src = URL.createObjectURL(file);
  });
}

/* --- Visual helpers --- */
export const coverSrc = item => item.cover || '';

function hasDriveSource(item) {
  return Boolean(driveFileId(item.link) || (item.seasons || []).some(season =>
    (season.episodes || []).some(episode => driveFileId(episode.link))));
}

const PALETTES = [
  ['#5b3df0', '#b8367a'], ['#0e5aa8', '#4fd1ff'], ['#b8367a', '#ff9d5c'],
  ['#1c8f6e', '#4fd1ff'], ['#8b7bff', '#ff5c8a'], ['#d97b28', '#8b2f8f']
];

export function gradientFor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[h % PALETTES.length];
  return `linear-gradient(140deg, ${a}, ${b})`;
}

export function coverHtml(item) {
  const src = coverSrc(item);
  const localLabel = item.type === 'show' ? 'Local episodes available' : 'Downloaded locally';
  const hasDrive = hasDriveSource(item);
  return `<div class="cover" style="background:${gradientFor(item.title)}">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy" data-remove-on-error>` : ''}
    <div class="cover-fallback">${esc((item.title || '?')[0].toUpperCase())}</div>
    <span class="type-tag">${item.type === 'show' ? 'SERIES' : 'FILM'}</span>
    ${item.watched ? '<span class="watched-tag" title="Watched">✓</span>' : ''}
    <span class="local-download-tag" data-local-download="${esc(item.id)}"
      title="${localLabel}" aria-label="${localLabel}" ${hasLocalDownload(item.id) ? '' : 'hidden'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></svg>
    </span>
    <span class="missing-local-tag" data-missing-local="${esc(item.id)}"
      data-has-drive="${hasDrive}"
      title="Some linked files are unavailable" aria-label="Some linked files are unavailable"
      ${hasMissingLocalMedia(item.id) && !hasLocalDownload(item.id) && !hasDrive
        ? '' : 'hidden'}>!</span>
  </div>`;
}
