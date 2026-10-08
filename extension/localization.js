/* Recognition only. The original collection and comparison never use translations. */
globalThis.F4FSelectors = (() => {
  const closeLabels = ['Close', 'Kapat', 'Cerrar', 'Fermer', 'Schließen', 'Chiudi',
    'Fechar', 'Закрыть', 'إغلاق', '閉じる', '닫기'];
  const profileLabels = ['Profile', 'Profil', 'Perfil', 'Profilo', 'Профиль',
    'الملف الشخصي', 'プロフィール', '프로필'];
  const reserved = new Set(['accounts', 'explore', 'reels', 'reel', 'p', 'direct',
    'stories', 'notifications', 'about', 'developer', 'legal', 'privacy', 'challenge']);
  const normalize = text => String(text || '').trim().toLocaleLowerCase();
  function usernameFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (!['www.instagram.com', 'instagram.com'].includes(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      const name = parts[0];
      return parts.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(name) &&
        !reserved.has(name.toLowerCase()) ? name : null;
    } catch { return null; }
  }
  function ownProfile(document) {
    // Only explicitly labelled profile navigation with an avatar is evidence of identity.
    // Never infer the account from the currently visited URL or arbitrary profile links.
    const labels = new Set(profileLabels.map(normalize));
    const candidates = new Set();
    for (const link of document.querySelectorAll('a[href]')) {
      if (!link.querySelector('img')) continue;
      const texts = [link.getAttribute('aria-label'), link.getAttribute('title'), link.textContent,
        ...Array.from(link.querySelectorAll('[aria-label]'), el => el.getAttribute('aria-label'))];
      if (!texts.some(text => labels.has(normalize(text)))) continue;
      const username = usernameFromHref(link.getAttribute('href'));
      if (username) candidates.add(username);
    }
    return candidates.size === 1 ? [...candidates][0] : null;
  }
  function querySelector(document, selector) {
    const original = document.querySelector(selector);
    if (original || !/^div\[role="dialog"\] (svg|button)\[aria-label="Close"\]$/.test(selector)) {
      return original;
    }
    const tag = selector.includes(' svg') ? 'svg' : 'button';
    for (const label of closeLabels) {
      const match = document.querySelector(`div[role="dialog"] ${tag}[aria-label="${label}"]`);
      if (match) return match;
    }
    return null;
  }
  return { closeLabels, profileLabels, usernameFromHref, ownProfile, querySelector };
})();
