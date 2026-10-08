
(() => {
  if (globalThis.F4FTheme) return;
  const modes = new Set(['system', 'light', 'dark']);
  const media = matchMedia('(prefers-color-scheme: dark)');
  const targets = new Set();
  const listeners = new Set();
  let preference = 'system';
  let revision = 0;
  const palettes = {
    light: {
      bg: '#FFFFFF', surface: '#F5F5F5', text: '#121212', muted: '#625b68',
      border: '#eee8ef', accent: '#833AB4', primary: '#833AB4', 'primary-hover': '#6d2f97',
      'on-primary': '#FFFFFF', tint: '#f6edf9', hover: '#faf5fc', ring: '#e1d6e6',
      error: '#b42318', 'error-border': '#f1beb8', 'error-bg': '#fff3f1',
      shadow: '#12121240', 'banner-shadow': '#12121224'
    },
    dark: {
      bg: '#0C1014', surface: '#151A1F', text: '#F5F5F5', muted: '#A8ADB3',
      border: '#2B3036', accent: '#C58CE8', primary: '#833AB4', 'primary-hover': '#9547c6',
      'on-primary': '#FFFFFF', tint: '#251B30', hover: '#251B30', ring: '#4b365b',
      error: '#FF938B', 'error-border': '#70352f', 'error-bg': '#2f1a1b',
      shadow: '#00000080', 'banner-shadow': '#00000066'
    }
  };
  const effective = () => preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  function update() {
    for (const target of targets) {
      if (!target.isConnected) { targets.delete(target); continue; }
      target.setAttribute('data-f4f-theme', effective());
    }
    for (const listener of listeners) listener(preference);
  }
  function accept(value) {
    revision++;
    preference = modes.has(value) ? value : 'system';
    update();
  }
  const initialRevision = revision;
  const ready = Promise.resolve(chrome.storage?.local?.get('appearance')).then(saved => {
    if (revision === initialRevision) accept(saved?.appearance);
  }).catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.appearance) accept(changes.appearance.newValue);
  });
  media.addEventListener('change', () => { if (preference === 'system') update(); });
  const variables = mode => `color-scheme:${mode};` + Object.entries(palettes[mode])
    .map(([name, value]) => `--f4f-${name}:${value}`).join(';');
  globalThis.F4FTheme = {
    ready,
    css: scope => `${scope}{${variables('light')}}${scope === ':host' ?
      ':host([data-f4f-theme="dark"])' : `${scope}[data-f4f-theme="dark"]`}{${variables('dark')}}`,
    attach(target) { targets.add(target); target.setAttribute('data-f4f-theme', effective()); },
    subscribe(listener) { listeners.add(listener); listener(preference); return () => listeners.delete(listener); },
    async setPreference(value) {
      if (!modes.has(value)) throw new Error('Choose System, Light, or Dark.');
      await chrome.storage.local.set({ appearance: value });
      accept(value);
    }
  };
})();
