'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AECPTheme = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const ORDER = Object.freeze(['system', 'dark', 'light']);
  const KEY = 'aecp-theme';

  function readStored(storage) {
    try {
      const value = storage?.getItem?.(KEY);
      return ORDER.includes(value) ? value : 'system';
    } catch { return 'system'; }
  }

  // media is the (prefers-color-scheme: light) MediaQueryList; matches === true means the OS prefers light.
  function createThemeController({ storage = null, media = null } = {}) {
    let theme = readStored(storage);
    return {
      get theme() { return theme; },
      resolved() {
        if (theme !== 'system') return theme;
        return media?.matches ? 'light' : 'dark';
      },
      cycle() {
        theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
        try { storage?.setItem?.(KEY, theme); } catch { /* the choice still applies for this session */ }
        return theme;
      },
      // An OS colour-scheme change only matters while the theme follows the system.
      followsSystem() { return theme === 'system'; }
    };
  }

  return { ORDER, KEY, createThemeController };
});
