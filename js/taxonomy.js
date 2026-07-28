/* ================= Library intelligence (genres, categories, tags) ================= */
import { driveFileId } from './drive.js';
import { formatShowDates } from './format.js';
import { state, saveLibrary } from './state.js';

const GENRE_ALIASES = {
  'sci fi': 'Sci-Fi & Fantasy',
  'sci-fi': 'Sci-Fi & Fantasy',
  'science fiction': 'Sci-Fi & Fantasy',
  'fantasy': 'Sci-Fi & Fantasy',
  'thriller': 'Thrillers',
  'mystery': 'Crime & Mystery',
  'crime': 'Crime & Mystery',
  'detective': 'Crime & Mystery',
  'romcom': 'Romance',
  'rom-com': 'Romance',
  'family': 'Family',
  'kids': 'Family',
  'children': 'Family',
  'stand up': 'Stand-Up & Variety',
  'stand-up': 'Stand-Up & Variety'
};

const CATEGORY_RULES = [
  ['Action & Adventure', /\b(action|adventure|superhero|spy|martial|mission|quest|battle|war|survival)\b/i],
  ['Comedy', /\b(comedy|comic|funny|sitcom|satire|parody)\b/i],
  ['Drama', /\b(drama|dramatic|family saga|coming.of.age|period)\b/i],
  ['Sci-Fi & Fantasy', /\b(sci.?fi|science fiction|fantasy|space|alien|future|supernatural|magic|dystopia|time travel)\b/i],
  ['Thrillers', /\b(thriller|suspense|tense|paranoid|survival|conspiracy)\b/i],
  ['Crime & Mystery', /\b(crime|mystery|detective|murder|heist|investigation|noir|serial killer)\b/i],
  ['Horror', /\b(horror|scary|haunted|ghost|monster|slasher|zombie|vampire)\b/i],
  ['Romance', /\b(romance|romantic|love story|rom-com|relationship)\b/i],
  ['Animation', /\b(animation|animated|anime|cartoon)\b/i],
  ['Family', /\b(family|kids|children|all ages)\b/i],
  ['Documentaries', /\b(documentary|docuseries|true story|biography|nature)\b/i],
  ['Reality & Competition', /\b(reality|competition|contest|cooking|makeover|dating)\b/i],
  ['Stand-Up & Variety', /\b(stand.?up|variety|sketch|special)\b/i],
  ['Music & Musicals', /\b(music|musical|concert|band|singer)\b/i],
  ['Sports', /\b(sport|football|basketball|soccer|tennis|boxing|racing)\b/i]
];

export const CATEGORY_ORDER = [
  'Action & Adventure', 'Comedy', 'Drama', 'Sci-Fi & Fantasy', 'Thrillers',
  'Crime & Mystery', 'Horror', 'Romance', 'Animation', 'Family',
  'Documentaries', 'Reality & Competition', 'Stand-Up & Variety',
  'Music & Musicals', 'Sports', 'Limited Series', 'Long-Run Shows'
];



export function labelCase(raw) {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  const key = clean.toLowerCase().replace(/[&/]+/g, ' ').replace(/\s+/g, ' ');
  if (!clean) return '';
  if (GENRE_ALIASES[key]) return GENRE_ALIASES[key];
  return clean.split(' ').map(w => {
    const lower = w.toLowerCase();
    if (['tv', 'ii', 'iii', 'iv'].includes(lower)) return lower.toUpperCase();
    if (['and', 'or', 'of', 'the'].includes(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

export function explicitGenreLabels(item) {
  return [...new Set(String(item.genre || '')
    .split(/[,·|/]/)
    .map(labelCase)
    .filter(Boolean))];
}

export function episodeCount(item) {
  return (item.seasons || []).reduce((n, s) => n + (s.episodes || []).length, 0);
}

export function itemText(item) {
  const episodes = (item.seasons || []).flatMap(s => (s.episodes || [])
    .flatMap(ep => [ep.title, ep.subtitle, ep.airdate])).filter(Boolean).slice(0, 30).join(' ');
  return [item.title, item.genre, item.subtitle, formatShowDates(item), item.type, episodes]
    .filter(Boolean).join(' ');
}



export function itemRecommendationProfile(item) {
  const topText = [item.title, item.genre, item.subtitle, formatShowDates(item), item.type]
    .filter(Boolean).join(' ');
  const categorySet = new Set(explicitGenreLabels(item));
  for (const [label, re] of CATEGORY_RULES)
    if (re.test(topText)) categorySet.add(label);
  if (item.type === 'show') {
    const eps = episodeCount(item);
    if (eps && eps <= 10) categorySet.add('Limited Series');
    if (eps >= 30) categorySet.add('Long-Run Shows');
  }
  const categories = [...categorySet];
  const tags = [...new Set([
    ...(item.ollamaTags || []),
    ...categories.map(c => c.toLowerCase().replace(/&/g, '').replace(/\s+/g, '-'))
  ])];
  return { text: topText, categories, tags };
}

export async function generateOllamaTags(item) {
  const prompt = `You are a film and TV expert. Generate an array of exactly 5 descriptive, one-word conceptual tags (like "superhero", "gritty", "heist", "romance") for the following ${item.type}:
Title: ${item.title}
Genre: ${item.genre || ''}
Synopsis: ${item.subtitle || ''}

Respond with only a JSON array of strings. Do not include markdown formatting or explanations.`;

  try {
    const r = await fetch('/api/concierge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.settings.model || 'llama3.2',
        format: 'json',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    
    if (!r.ok) return [];
    
    const text = await r.text();
    let fullText = '';
    for (const line of text.trim().split('\n')) {
      try { fullText += JSON.parse(line).message.content; } catch {}
    }
    
    const tags = JSON.parse(fullText);
    if (Array.isArray(tags)) return tags.slice(0, 5).map(t => String(t).toLowerCase());
  } catch (e) {
    console.warn('Ollama tagging failed', e);
  }
  return [];
}

export async function startTaggingWorker() {
  for (const item of state.library) {
    if (!item.ollamaTags) {
      const tags = await generateOllamaTags(item);
      if (tags && tags.length > 0) {
        item.ollamaTags = tags;
        saveLibrary();
      }
    }
  }
}

export function itemCategories(item) {
  const text = itemText(item);
  const labels = new Set(explicitGenreLabels(item));
  for (const [label, re] of CATEGORY_RULES)
    if (re.test(text)) labels.add(label);
  if (item.type === 'movie') labels.add('Movies');
  if (item.type === 'show') {
    labels.add('TV Shows');
    const eps = episodeCount(item);
    if (eps && eps <= 10) labels.add('Limited Series');
    if (eps >= 30) labels.add('Long-Run Shows');
  }
  return [...labels];
}

// a title/episode is playable if it has a valid Drive link OR a local file path
export function playablePosition(item) {
  if (!item) return null;
  if (item.type === 'movie')
    return (driveFileId(item.link) || item.localPath || item.localAvailable) ? { s: 0, e: 0 } : null;
  for (let s = 0; s < (item.seasons || []).length; s++) {
    const episodes = item.seasons[s].episodes || [];
    for (let e = 0; e < episodes.length; e++)
      if (driveFileId(episodes[e].link) || episodes[e].localPath || episodes[e].localAvailable)
        return { s, e };
  }
  return null;
}

export function isPlayable(item) {
  return Boolean(playablePosition(item));
}
