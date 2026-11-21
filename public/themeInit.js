(function () {
  try {
    var raw = window.localStorage && window.localStorage.getItem('arctic_theme_bootstrap');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    var mode = parsed.theme;
    var isDark = false;
    if (mode === 'dark') {
      isDark = true;
    } else if (mode === 'system' && typeof window.matchMedia === 'function') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    var root = document.documentElement;
    if (root) {
      root.classList.toggle('dark', isDark);
      root.classList.toggle('light', !isDark);
      if (typeof parsed.colorTheme === 'string' && parsed.colorTheme) {
        root.setAttribute('data-color-theme', parsed.colorTheme);
      }
    }
  } catch (_e) {
    // Ignore bootstrap errors and fall back to static HTML attributes
  }
})();
