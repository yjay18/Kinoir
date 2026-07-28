/* ================= AI Concierge (local, via Ollama) ================= */
import { state, store, saveSettings } from './state.js';
import { $, esc, toast } from './dom.js';
import { coverSrc, gradientFor } from './covers.js';
import { formatShowDates } from './format.js';
import { itemRecommendationProfile, isPlayable } from './taxonomy.js';
import { braveContext, wantsWebContext } from './metadata.js';
import { focusFirst } from './nav.js';

let chatLog = store.get('chat', []);          // [{role, text}]
const braveConfigured = () => Boolean(state.settings.braveKeyConfigured || state.settings.braveKey);

const saveChat = () => { chatLog = chatLog.slice(-40); store.set('chat', chatLog); };

/* ---------- suggestion scope UI ---------- */
export function syncSuggestionScopeUi() {
  const outside = state.settings.allowOutsideSuggestions;
  const btn = $('#btn-scope');
  if (btn) {
    btn.classList.toggle('outside', outside);
    btn.textContent = outside ? '◎ Outside' : '⌂ Library';
    btn.title = outside
      ? 'Outside suggestions enabled'
      : 'Library-only suggestions';
  }
  $('#chat-scope-library')?.classList.toggle('active', !outside);
  $('#chat-scope-outside')?.classList.toggle('active', outside);
  const sub = $('#chat-sub');
  if (sub) sub.textContent = outside
    ? (state.settings.useBraveSearch && braveConfigured()
      ? 'Outside suggestions · Brave context on'
      : 'Outside suggestions · model knowledge')
    : 'Runs locally via Ollama · library-only';
  const input = $('#chat-input');
  if (input) input.placeholder = outside
    ? 'Ask for library or outside ideas…'
    : 'Ask from your library…';
}

export function setOutsideSuggestions(enabled) {
  state.settings.allowOutsideSuggestions = Boolean(enabled);
  saveSettings();
  syncSuggestionScopeUi();
  if (!$('#chat-panel')?.hidden) renderChat();
  toast(state.settings.allowOutsideSuggestions
    ? (state.settings.useBraveSearch && braveConfigured()
      ? 'Outside suggestions on — Brave context enabled'
      : 'Outside suggestions on — using model knowledge')
    : 'Library-only suggestions on');
}

/* ---------- chat panel ---------- */
export function toggleChat(open) {
  const panel = $('#chat-panel');
  panel.hidden = open === undefined ? !panel.hidden : !open;
  if (!panel.hidden) {
    buildConciergeContext();
    renderChat();
    $('#chat-input').focus();
  }
  else focusFirst();
}

export function renderChat() {
  syncSuggestionScopeUi();
  const box = $('#chat-messages');
  if (!chatLog.length) {
    const outside = state.settings.allowOutsideSuggestions;
  box.innerHTML = `<div class="msg assistant">Hi! I'm your concierge — I run locally on your
Mac through Ollama (${esc(state.settings.model || 'llama3.2')}). Ask me anything about films
and TV, or just chat. ${outside
  ? `Outside suggestions are <b>on</b>, so I can point you to great stuff beyond your library too${state.settings.useBraveSearch && braveConfigured() ? ', with live Brave search when it helps' : ''}.`
  : `I'm in <b>library-only</b> mode — every recommendation will come from a title you own.`}\n\nTop icons: ⌂ library-only · ◎ outside suggestions. Press ⟳ to refresh my snapshot of your library.</div>`;
    return;
  }
  box.innerHTML = chatLog.map(m =>
    `<div class="msg ${m.role}">${esc(m.text)}</div>${
      m.role === 'assistant' ? chatCardsForMessage(m) : ''}`).join('');
  box.scrollTop = box.scrollHeight;
}

/* library titles mentioned in a reply become clickable play-cards */
function chatCardsForMessage(message) {
  if (Array.isArray(message.cards) && message.cards.length) {
    const cardItems = message.cards.map((id, idx) => ({
      item: state.library.find(i => i.id === id),
      reason: message.cardReasons?.[idx] || ''
    })).filter(x => x.item);
    return chatCardsHtml(cardItems, { playlist: message.cardStyle === 'playlist' });
  }
  return titleCardsHtml(message.text);
}

function titleCardsHtml(text) {
  const t = String(text || '').toLowerCase();
  const found = state.library.filter(i => i.title.length > 2 &&
    t.includes(i.title.toLowerCase())).slice(0, 4).map(item => ({ item }));
  if (!found.length) return '';
  return chatCardsHtml(found);
}

function chatCardsHtml(cards, opts = {}) {
  if (!cards.length) return '';
  return `<div class="chat-cards ${opts.playlist ? 'playlist' : ''}">${cards.map((card, idx) => {
    const i = card.item;
    const log = state.watchLog.find(w => w.itemId === i.id);
    const sub = i.type === 'show'
      ? (log ? `Resume S${log.s + 1} E${log.e + 1}` : 'Series · play E1')
      : (log ? 'Film · resume' : 'Film · play');
    const src = coverSrc(i);
    return `<button class="chat-card ${opts.playlist ? 'playlist-card' : ''}" data-chat-play="${i.id}">
      ${opts.playlist ? `<span class="chat-card-rank">${idx + 1}</span>` : ''}
      <span class="chat-card-cover" style="background:${gradientFor(i.title)}">
        ${src ? `<img src="${esc(src)}" alt="">` : esc((i.title[0] || '?').toUpperCase())}
      </span>
      <span class="chat-card-info"><b>${esc(i.title)}</b><small>▶ ${sub}</small>
        ${card.reason ? `<span class="chat-card-reason">${esc(card.reason)}</span>` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

// used only to decide whether to fetch optional Brave web context before the model runs
function isRecommendationIntent(text) {
  return /\b(recommend(?:ation|ations)?|suggest(?:ion|ions)?|what should i watch|what to watch|pick|choose|find me|give me|show me|list (?:some|a few)|something like|similar to|playlist|queue|lineup|curate|watchlist|movie night|binge|good|best|tonight|mood|ideas|options)\b/i.test(text);
}

const recommendationStopWords = new Set([
  'about', 'after', 'again', 'also', 'best', 'choose', 'find', 'from', 'give', 'good',
  'have', 'ideas', 'library', 'list', 'movie', 'movies', 'option', 'options', 'pick',
  'please', 'recommend', 'recommendation', 'recommendations', 'series', 'show', 'shows',
  'something', 'suggest', 'suggestion', 'suggestions', 'that', 'the', 'this', 'tonight',
  'want', 'watch', 'what', 'with', 'would', 'your'
]);

function recommendationTerms(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter(word => word.length > 2 && !recommendationStopWords.has(word));
}

function matchesRequestedType(item, request) {
  const wantsMovie = /\b(movie|movies|film|films)\b/i.test(request);
  const wantsShow = /\b(show|shows|series|binge)\b/i.test(request);
  if (wantsMovie && !wantsShow) return item.type === 'movie';
  if (wantsShow && !wantsMovie) return item.type === 'show';
  return true;
}

function fallbackLibraryPicks(request, max = 4) {
  const terms = recommendationTerms(request);
  const wantsMovie = /\b(movie|film)\b/i.test(request);
  const wantsShow = /\b(show|series|binge)\b/i.test(request);
  const wantsResume = /\b(resume|continue|finish|started)\b/i.test(request);
  const inProgress = new Set(state.watchLog.map(entry => entry.itemId));

  return state.library.filter(item => matchesRequestedType(item, request)).map((item, index) => {
    const profile = itemRecommendationProfile(item);
    const searchable = [item.title, item.genre, item.subtitle,
      ...profile.categories, ...profile.tags].filter(Boolean).join(' ').toLowerCase();
    let score = terms.reduce((total, term) => total + (searchable.includes(term) ? 5 : 0), 0);
    if (wantsMovie) score += item.type === 'movie' ? 4 : -2;
    if (wantsShow) score += item.type === 'show' ? 4 : -2;
    if (wantsResume && inProgress.has(item.id)) score += 8;
    if (!item.watched) score += 2;
    if (isPlayable(item)) score += 1;
    return { item, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.min(max, state.library.length)).map(entry => entry.item);
}

function parseGroundedPicks(raw, request) {
  const source = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let payload;
  try { payload = JSON.parse(source.slice(start, end + 1)); }
  catch { return []; }
  const picks = Array.isArray(payload.recommendations) ? payload.recommendations : [];
  const used = new Set();
  const validated = [];
  for (const pick of picks) {
    const number = Number(pick?.catalogNumber ?? pick?.id);
    let item = Number.isInteger(number) && number >= 1 ? state.library[number - 1] : null;
    if (!item && pick?.title) {
      const wanted = String(pick.title).trim().toLowerCase();
      item = state.library.find(candidate => candidate.title.toLowerCase() === wanted);
    }
    if (!item || !matchesRequestedType(item, request) || used.has(item.id)) continue;
    used.add(item.id);
    validated.push(item);
    if (validated.length === 5) break;
  }
  return validated;
}

function groundedReason(item, request) {
  if (state.watchLog.some(entry => entry.itemId === item.id))
    return item.type === 'show' ? 'Already in progress — ready to resume.' : 'Already in progress — ready to finish.';
  const profile = itemRecommendationProfile(item);
  const terms = recommendationTerms(request);
  const seen = new Set();
  const matches = [...profile.categories, ...profile.tags]
    .filter(value => terms.some(term => String(value).toLowerCase().includes(term)))
    .filter(value => {
      const key = String(value).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
  const kind = item.type === 'show' ? 'series' : 'film';
  if (matches.length) return `${matches.join(' · ')} ${kind} that matches your request.`;
  if (item.genre) return `${item.genre} ${kind} from your library.`;
  return `${item.type === 'show' ? 'Series' : 'Film'} from your library.`;
}

function groundedRecommendationMessage(request, raw) {
  const picked = parseGroundedPicks(raw, request);
  const items = picked.length ? picked : fallbackLibraryPicks(request);
  if (!items.length) return {
    text: 'Your library is empty, so I do not have a library-only recommendation yet.',
    cards: [], cardReasons: [], cardStyle: 'playlist'
  };
  const reasons = items.map(item => groundedReason(item, request));
  return {
    text: `Here are my best matches from your library:\n\n${items.map((item, index) =>
      `${index + 1}. ${item.title} — ${reasons[index]}`).join('\n')}`,
    cards: items.map(item => item.id),
    cardReasons: reasons,
    cardStyle: 'playlist'
  };
}

function continueSummary() {
  const parts = state.watchLog.slice(0, 5).map(w => {
    const item = state.library.find(i => i.id === w.itemId);
    if (!item) return null;
    return item.type === 'show' ? `${item.title} (at S${w.s + 1} E${w.e + 1})` : item.title;
  }).filter(Boolean);
  return parts.length ? parts.join('; ') : 'nothing in progress';
}

function watchedSummary() {
  const parts = state.library.filter(i => i.watched).map(i => i.title);
  return parts.length ? parts.join('; ') : 'none';
}

function librarySummary() {
  if (!state.library.length) return 'The library is currently empty.';
  return state.library.map((i, n) => {
    const kind = i.type === 'movie'
      ? 'Movie' : `Series, ${(i.seasons || []).length} season(s)`;
    const profile = itemRecommendationProfile(i);
    const cats = profile.categories.slice(0, 5).join(', ');
    const tags = profile.tags.slice(0, 8).join(', ');
    const meta = [
      i.genre && `genre: ${i.genre}`,
      cats && `categories: ${cats}`,
      tags && `tags: ${tags}`,
      formatShowDates(i) && `dates: ${formatShowDates(i)}`,
      i.subtitle && `about: ${i.subtitle}`,
      isPlayable(i) ? 'playable: yes' : 'playable: missing Drive link',
      i.watched && 'watched: yes'
    ]
      .filter(Boolean).join('; ');
    return `${n + 1}. "${i.title}" — ${kind}${meta ? ` (${meta})` : ''}`;
  }).join('\n');
}

function buildConciergeContext() {
  state.conciergeContext = {
    library: librarySummary(),
    continueWatching: continueSummary(),
    watched: watchedSummary(),
    ts: Date.now()
  };
  return state.conciergeContext;
}

function conciergeSnapshot() {
  return state.conciergeContext || buildConciergeContext();
}

export function refreshConciergeContext(showToast = false) {
  buildConciergeContext();
  if (showToast) toast('Concierge context refreshed ✓');
}

/* --- Local LLM via Ollama, proxied through the app server (same-origin, no CORS) --- */
function setChatStatus(text) {
  let s = $('#chat-status');
  if (!s) {
    $('#chat-messages').insertAdjacentHTML('beforeend',
      '<div class="msg status" id="chat-status"></div>');
    s = $('#chat-status');
  }
  s.textContent = text;
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}

// POST to /api/concierge and read Ollama's NDJSON stream, firing onToken per delta.
async function streamOllama(messages, temperature, onToken, format) {
  const res = await fetch('/api/concierge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: state.settings.model || 'llama3.2', messages, temperature, format })
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* keep status */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.error) throw new Error(obj.error);
      const delta = obj.message?.content || '';
      if (delta) onToken(delta);
      if (obj.done) return;
    }
  }
  const tail = buf.trim();
  if (tail) { try { const o = JSON.parse(tail); if (o.message?.content) onToken(o.message.content); } catch { /* ignore */ } }
}

export async function sendChat(text) {
  chatLog.push({ role: 'user', text });
  saveChat();
  renderChat();

  const outsideMode = state.settings.allowOutsideSuggestions;
  const wantsRecommendation = isRecommendationIntent(text);

  // Outside mode streams the model naturally. Library-only recommendation requests use
  // validated catalogue numbers so an invented/outside title can never reach the UI.
  let webCtx = '';
  const canSearch = outsideMode && state.settings.useBraveSearch && braveConfigured();
  if (canSearch && (wantsWebContext(text) || wantsRecommendation)) {
    setChatStatus('checking Brave Search…');
    try { webCtx = await braveContext(text); } catch { /* search is optional context */ }
  }
  setChatStatus('thinking…');

  try {
    const context = conciergeSnapshot();
    const groundedRecommendation = !outsideMode && wantsRecommendation;
    const prompt = `You are the Kinoir Concierge — a warm, sharp, opinionated film and
TV buff living inside the user's personal streaming app. Talk naturally and freely: chat,
riff, share real opinions, trivia and hot takes, answer whatever they ask. You don't have
to recommend something every time — only when it actually fits the conversation.

The user's library — the titles they can play right here in the app:
${context.library}

Continuing / partway through: ${context.continueWatching}
Already watched: ${context.watched}

RECOMMENDATION SCOPE — THIS IS A HARD OUTPUT RULE:
- ${outsideMode
    ? `Outside suggestions are ON. You may recommend titles outside the catalogue, but clearly say they are not in the user's library.`
    : `Library-only mode is ON. If the user asks what to watch, asks for suggestions, a list,
  a playlist, alternatives, or recommendations, EVERY suggested title must be copied from
  the numbered library catalogue above. Never add an outside alternative, classic, honourable
  mention, comparison title, or invented sequel. If the library has too few matches, say so.`}

Other behaviour:
- When you mention a title that's in the library above, write it EXACTLY as listed — the
  app turns those into clickable "play" buttons for them.
- For "what should I watch" moments, lean toward what they own, and feel free to nudge
  them to finish something they've started.
${canSearch && webCtx ? `\nFresh web context you can use if handy:\n${webCtx}\n` : ''}
Keep it conversational and human. Plain text — skip markdown formatting.`;

    const groundedContract = groundedRecommendation ? `

For this recommendation request, return ONLY valid JSON in exactly this shape:
{"recommendations":[{"catalogNumber":12},{"catalogNumber":47}]}
Use between 1 and 5 catalogue numbers from the numbered library above. A catalogue number
is the number at the start of a library line. Do not return titles, prose, markdown, reasons,
or any number that is not present in the catalogue. Re-check every number before answering.` : '';

    const messages = [
      { role: 'system', content: prompt + groundedContract },
      ...chatLog.slice(-12).map(m => ({ role: m.role, content: m.text }))
    ];
    chatLog.push({ role: 'assistant', text: '' });
    const idx = chatLog.length - 1;
    if (groundedRecommendation) {
      let raw = '';
      setChatStatus('checking your library…');
      await streamOllama(messages, 0.2, delta => { raw += delta; }, 'json');
      Object.assign(chatLog[idx], groundedRecommendationMessage(text, raw));
    } else {
      await streamOllama(messages, outsideMode ? 0.85 : 0.6, delta => {
        $('#chat-status')?.remove();
        chatLog[idx].text += delta;
        renderChat();
      });
    }
    $('#chat-status')?.remove();
    if (!chatLog[idx].text) chatLog[idx].text = '(no reply)';
  } catch (err) {
    $('#chat-status')?.remove();
    if (chatLog.length && chatLog[chatLog.length - 1].role === 'assistant'
        && !chatLog[chatLog.length - 1].text)
      chatLog[chatLog.length - 1].text = `⚠️ ${err.message || err}`;
    else
      chatLog.push({ role: 'assistant', text: `⚠️ ${err.message || err}` });
  }
  saveChat();
  renderChat();
}
