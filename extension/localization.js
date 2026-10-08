/* Recognition only. The original collection and comparison never use translations. */
globalThis.F4FSelectors = (() => {
  const closeLabels = ['Close', 'Kapat', 'Cerrar', 'Fermer', 'Schließen', 'Chiudi',
    'Fechar', 'Закрыть', 'إغلاق', '閉じる', '닫기'];
  const profileLabels = ['Profile', 'Profil', 'Perfil', 'Profilo', 'Профиль',
    'الملف الشخصي', 'プロフィール', '프로필'];
  const editProfileLabels = ['Edit profile', 'Profili düzenle', 'Editar perfil',
    'Modifier le profil', 'Profil bearbeiten', 'Modifica profilo', 'Редактировать профиль',
    'تعديل الملف الشخصي', 'プロフィールを編集', '프로필 편집'];
  const reserved = new Set(['accounts', 'explore', 'reels', 'reel', 'p', 'direct',
    'stories', 'notifications', 'about', 'developer', 'legal', 'privacy', 'challenge']);
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
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
  function visible(element) {
    return !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0 &&
      (typeof getComputedStyle !== 'function' || getComputedStyle(element).visibility !== 'hidden');
  }
  function labelsFor(element) {
    return [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent,
      ...Array.from(element.querySelectorAll('[aria-label], svg title'), child =>
        child.getAttribute('aria-label') || child.textContent)].map(normalize);
  }
  function profileControl(document) {
    // Instagram's sidebar need not be a <nav>, and the Profile control need not
    // contain an avatar. Use its explicit text/accessibility label, excluding posts.
    const labels = new Set(profileLabels.map(normalize));
    const candidates = [];
    for (const control of document.querySelectorAll('a[href], button, [role="button"], [role="link"]')) {
      if (!visible(control) || control.closest('article, [role="dialog"]')) continue;
      if (control.closest('main, [role="main"]') && !control.closest('nav, aside, [role="navigation"]')) continue;
      if (!labelsFor(control).some(label => labels.has(label))) continue;
      const href = control.getAttribute('href');
      const name = href ? usernameFromHref(href) : null;
      if (href && !name) continue;
      candidates.push({ control, username: name });
    }
    const links = candidates.filter(candidate => candidate.username);
    if (links.length) {
      return new Set(links.map(candidate => candidate.username)).size === 1 ? links[0] : null;
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  function ownProfile(document) {
    return profileControl(document)?.username || null;
  }
  function currentOwnProfile(document) {
    const name = usernameFromHref(location.href);
    if (!name) return null;
    const labels = new Set(editProfileLabels.map(normalize));
    // Edit profile is self-only evidence. Do not trust the visited pathname alone.
    const scope = document.querySelector('main, [role="main"]') || document;
    for (const control of scope.querySelectorAll('a[href], button, [role="button"], [role="link"]')) {
      if (!visible(control) || control.closest('article, [role="dialog"]')) continue;
      const href = control.getAttribute('href');
      if (href) {
        try {
          const url = new URL(href, location.origin);
          if (['www.instagram.com', 'instagram.com'].includes(url.hostname) &&
            url.pathname.replace(/\/+$/, '') === '/accounts/edit') return name;
        } catch { /* Text-labelled buttons remain available below. */ }
      }
      if (labelsFor(control).some(label => labels.has(label))) return name;
    }
    return null;
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
  return { closeLabels, profileLabels, editProfileLabels, usernameFromHref,
    profileControl, ownProfile, currentOwnProfile, querySelector };
})();
