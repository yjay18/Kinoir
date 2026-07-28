/* ================= Local media availability =================
   The saved path is only a hint; the desktop server confirms the file still
   exists before a cover receives its local-download badge. */

const available = new Set();
const missing = new Set();
const availableFiles = new Set();
const missingFiles = new Set();
let inflight = null;
let checkedAt = 0;
let monitorStarted = false;
let scheduledRefresh = 0;

export const hasLocalDownload = id => available.has(String(id));
export const hasMissingLocalMedia = id => missing.has(String(id));
export const hasMissingLocalFile = key => missingFiles.has(String(key));

function syncBadges() {
  document.querySelectorAll('[data-local-download]').forEach(badge => {
    badge.hidden = !available.has(badge.dataset.localDownload);
  });
  document.querySelectorAll('[data-missing-local]').forEach(element => {
    const id = element.dataset.missingLocal;
    // A stale local path is not an actionable problem when the title can
    // still be played from Drive or another local file.
    const hasFallback = element.dataset.hasDrive === 'true' || available.has(id);
    element.hidden = !missing.has(id) || hasFallback;
  });
  document.querySelectorAll('[data-local-play]').forEach(button => {
    const unavailable = missing.has(button.dataset.localPlay) &&
      !available.has(button.dataset.localPlay);
    button.disabled = unavailable;
    button.title = unavailable ? 'Relink the local file to play this title' : '';
  });
  document.querySelectorAll('[data-local-file-key]').forEach(button => {
    const unavailable = missingFiles.has(button.dataset.localFileKey);
    button.classList.toggle('media-unavailable', unavailable);
    if (button.dataset.hasDrive !== 'true') button.disabled = unavailable;
    if (unavailable) button.title = button.dataset.hasDrive === 'true'
      ? 'Local file unavailable — the Drive link will be used'
      : 'Local file unavailable — edit this episode to relink it';
    else button.removeAttribute('title');
  });
}

export async function refreshLocalAvailability({ force = false } = {}) {
  syncBadges();
  if (inflight) return inflight;
  if (!force && Date.now() - checkedAt < 2000) return false;
  checkedAt = Date.now();
  inflight = fetch('/api/local-availability', { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      if (!Array.isArray(data.ids)) return false;
      const next = new Set(data.ids.filter(id => /^[\w-]+$/.test(String(id))).map(String));
      const nextMissing = new Set((Array.isArray(data.missingIds) ? data.missingIds : [])
        .filter(id => /^[\w-]+$/.test(String(id))).map(String));
      const nextAvailableFiles = new Set((Array.isArray(data.availableKeys) ? data.availableKeys : [])
        .filter(key => /^[\w-]+\/\d+\/\d+$/.test(String(key))).map(String));
      const nextMissingFiles = new Set((Array.isArray(data.missingKeys) ? data.missingKeys : [])
        .filter(key => /^[\w-]+\/\d+\/\d+$/.test(String(key))).map(String));
      const changed = next.size !== available.size || [...next].some(id => !available.has(id)) ||
        nextMissing.size !== missing.size || [...nextMissing].some(id => !missing.has(id)) ||
        nextAvailableFiles.size !== availableFiles.size ||
        [...nextAvailableFiles].some(key => !availableFiles.has(key)) ||
        nextMissingFiles.size !== missingFiles.size ||
        [...nextMissingFiles].some(key => !missingFiles.has(key));
      available.clear();
      next.forEach(id => available.add(id));
      missing.clear();
      nextMissing.forEach(id => missing.add(id));
      availableFiles.clear();
      nextAvailableFiles.forEach(key => availableFiles.add(key));
      missingFiles.clear();
      nextMissingFiles.forEach(key => missingFiles.add(key));
      syncBadges();
      return changed;
    })
    .catch(() => false)
    .finally(() => { inflight = null; });
  return inflight;
}

export function scheduleLocalAvailabilityRefresh() {
  syncBadges();
  window.clearTimeout(scheduledRefresh);
  // Library saves are debounced; wait for the server-side JSON to catch up.
  scheduledRefresh = window.setTimeout(() => {
    void refreshLocalAvailability({ force: true });
  }, 500);
}

export function startLocalAvailabilityMonitor() {
  if (monitorStarted) return;
  monitorStarted = true;
  void refreshLocalAvailability({ force: true });
  window.addEventListener('focus', () => void refreshLocalAvailability({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshLocalAvailability({ force: true });
  });
  setInterval(() => void refreshLocalAvailability({ force: true }), 30 * 1000);
}
