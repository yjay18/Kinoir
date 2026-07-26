/* ================= Appearance themes ================= */

export const THEMES = [
  { id: 'aurora', name: 'Aurora', description: 'Purple and cyan glow', colors: ['#8b7bff', '#4fd1ff', '#b8367a'] },
  { id: 'ember', name: 'Ember', description: 'Warm amber and coral', colors: ['#ff9a45', '#ff5f6d', '#7d3cff'] },
  { id: 'ocean', name: 'Ocean', description: 'Deep blue and teal', colors: ['#2f80ed', '#20d6c7', '#2850a7'] },
  { id: 'graphite', name: 'Graphite', description: 'Quiet, neutral contrast', colors: ['#a7b0c0', '#6e7b91', '#424b5c'] },
  { id: 'daylight', name: 'Daylight', description: 'Bright, soft glass', colors: ['#7557ff', '#0c9fc2', '#ffb45e'] },
  { id: 'system', name: 'System', description: 'Matches macOS appearance', colors: ['#f3f5fa', '#8b7bff', '#111827'] }
];

const THEME_IDS = new Set(THEMES.map(theme => theme.id));
const systemAppearance = window.matchMedia?.('(prefers-color-scheme: light)');

export function normaliseTheme(preference) {
  return THEME_IDS.has(preference) ? preference : 'aurora';
}

export function resolvedTheme(preference) {
  const normalised = normaliseTheme(preference);
  if (normalised !== 'system') return normalised;
  return systemAppearance?.matches ? 'daylight' : 'aurora';
}

export function applyTheme(preference) {
  const normalised = normaliseTheme(preference);
  document.documentElement.dataset.themePreference = normalised;
  document.documentElement.dataset.theme = resolvedTheme(normalised);
  return normalised;
}

export function watchSystemTheme(getPreference) {
  if (!systemAppearance?.addEventListener) return () => {};
  const update = () => {
    if (normaliseTheme(getPreference()) === 'system') applyTheme('system');
  };
  systemAppearance.addEventListener('change', update);
  return () => systemAppearance.removeEventListener('change', update);
}
