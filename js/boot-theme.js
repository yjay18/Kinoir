/* Apply the saved theme before the stylesheet paints to avoid a bright flash. */
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('lf:settings') || '{}');
    const choices = ['aurora', 'ember', 'ocean', 'graphite', 'daylight', 'system'];
    const preference = choices.includes(saved.theme) ? saved.theme : 'graphite';
    const theme = preference === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'aurora')
      : preference;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = theme;
  } catch { /* use the Aurora defaults */ }
})();
