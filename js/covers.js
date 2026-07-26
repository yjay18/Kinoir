/* ================= Covers & visual helpers ================= */
import { esc } from './dom.js';
import { hasLocalDownload } from './local-media.js';

/* --- Covers (data-URLs stored right in the library JSON) --- */
export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// keep the original file untouched when it's reasonably sized; only very large
// images get resized (still generous: 1200px wide, 90% quality)
export async function coverFromFile(file) {
  if (file.size <= 400 * 1024) return fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('bad image')); };
    img.src = URL.createObjectURL(file);
  });
}

/* --- Visual helpers --- */
export const coverSrc = item => item.cover || '';

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
  return `<div class="cover" style="background:${gradientFor(item.title)}">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy"
      onerror="this.remove()">` : ''}
    <div class="cover-fallback">${esc((item.title || '?')[0].toUpperCase())}</div>
    <span class="type-tag">${item.type === 'show' ? 'SERIES' : 'FILM'}</span>
    ${item.watched ? '<span class="watched-tag" title="Watched">✓</span>' : ''}
    <span class="local-download-tag" data-local-download="${esc(item.id)}"
      title="${localLabel}" aria-label="${localLabel}" ${hasLocalDownload(item.id) ? '' : 'hidden'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></svg>
    </span>
  </div>`;
}
