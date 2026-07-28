/* ================= Web lookup (free — TVMaze + Wikipedia, optional Brave) ================= */
import { state } from './state.js';

export const stripTags = s => String(s || '').replace(/<[^>]+>/g, '').trim();

export const withTimeout = (p, ms = 5000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function searchTVMaze(q) {
  const r = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return (await r.json()).slice(0, 5).map(x => tvmazeShowInfo(x.show));
}

export async function tvmazeShow(showId) {
  const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}`);
  if (!r.ok) return null;
  return tvmazeShowInfo(await r.json());
}

function tvmazeShowInfo(show) {
  return {
    id: show.id,
    title: show.name,
    year: (show.premiered || '').slice(0, 4),
    premiered: show.premiered || '',
    ended: show.ended || '',
    status: show.status || '',
    genres: show.genres || [],
    summary: stripTags(show.summary),
    image: show.image?.medium || ''
  };
}

/* full episode list for a TVMaze show id — keyless, grouped by season */
export async function tvmazeEpisodes(showId) {
  const r = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`);
  if (!r.ok) return [];
  const bySeason = {};
  for (const e of await r.json()) {
    (bySeason[e.season] ??= []).push({
      tvmazeId: e.id || '',
      season: e.season,
      number: e.number || '',
      title: e.name || `Episode ${e.number}`,
      airdate: e.airdate || '',
      subtitle: stripTags(e.summary)
    });
  }
  return Object.keys(bySeason).sort((a, b) => a - b)
    .map(n => ({ name: n === '0' ? 'Specials' : `Season ${n}`, episodes: bySeason[n] }));
}

export async function wikiSummary(title) {
  const sum = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title)).then(r => r.json());
  return { title: sum.title, summary: sum.extract || '',
    image: sum.thumbnail?.source || '', genres: null, wikiTitle: sum.title };
}

export async function wikiLookup(q) {
  const s = await fetch('https://en.wikipedia.org/w/api.php?action=opensearch' +
    `&search=${encodeURIComponent(q)}&limit=1&origin=*&format=json`).then(r => r.json());
  const title = s[1]?.[0];
  if (!title) return null;
  return wikiSummary(title);
}

async function braveSearch(q) {
  if (!state.settings.useBraveSearch ||
      !(state.settings.braveKeyConfigured || state.settings.braveKey)) return null;
  if (window.kinoir?.searchBrave) {
    const response = await window.kinoir.searchBrave(q);
    if (!response?.ok) throw new Error(response?.error || 'Brave search failed');
    return (response.results || []).map(result => ({
      title: result.title,
      desc: stripTags(result.description),
      url: result.url
    }));
  }
  // Browser-only development fallback. Packaged builds keep the key encrypted
  // behind the preload bridge and never expose it to page JavaScript.
  if (!state.settings.braveKey) return null;
  const r = await fetch('https://api.search.brave.com/res/v1/web/search' +
    `?q=${encodeURIComponent(q)}&count=5`,
    { headers: { 'X-Subscription-Token': state.settings.braveKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Brave search: HTTP ${r.status}`);
  const d = await r.json();
  return (d.web?.results || []).map(x =>
    ({ title: x.title, desc: stripTags(x.description), url: x.url }));
}

export function wantsWebContext(text) {
  return /\b(search|web|lookup|look up|current|latest|new|news|brave)\b/i.test(text);
}

export async function braveContext(query) {
  const results = await withTimeout(braveSearch(query), 6000);
  if (!results?.length) return '';
  return 'Brave Search results for optional recommendation context:\n' +
    results.map(x => `- ${x.title}: ${x.desc.slice(0, 200)}`).join('\n');
}
