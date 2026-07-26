/* ================= Local media availability =================
   The saved path is only a hint; the desktop server confirms the file still
   exists before a cover receives its local-download badge. */

const available = new Set();
let inflight = null;
let checkedAt = 0;
let monitorStarted = false;
let scheduledRefresh = 0;

export const hasLocalDownload = id => available.has(String(id));

function syncBadges() {
  document.querySelectorAll('[data-local-download]').forEach(badge => {
    badge.hidden = !available.has(badge.dataset.localDownload);
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
      const changed = next.size !== available.size || [...next].some(id => !available.has(id));
      available.clear();
      next.forEach(id => available.add(id));
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
