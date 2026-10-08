/* Profile controls and exact count recognition. No account comparison occurs here. */
globalThis.F4FListControls = (() => {
  const labels = {
    followers: ['followers', 'follower', 'takipçi', 'seguidores', 'abonnés', 'abonné',
      'подписчики', 'المتابعون', 'フォロワー', '팔로워'],
    following: ['following', 'takip', 'takip edilenler', 'seguidos', 'seguindo',
      'abonnements', 'abonnement', 'gefolgt', 'seguiti', 'подписки', 'يتابع', 'フォロー中', '팔로잉']
  };
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const count = '[\\p{N}.,\\s]+(?:[kmb]|万|億)?';
  function parseExactCount(value) {
    const text = String(value || '').normalize('NFKC')
      .replace(/[\u200e\u200f\u061c]/g, '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
      .replace(/٬/g, ',').trim().replace(/\s+/g, ' ');
    if (!/^\d+$/.test(text) && !/^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.test(text)) return null;
    const number = Number(text.replace(/[., ]/g, ''));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
  function expectedCount(document, username, type) {
    const control = find(document, username, type);
    if (!control) return null;
    const numbers = new Set();
    for (const node of [control, ...control.querySelectorAll('span, [title], [aria-label]')]) {
      for (const value of [node.getAttribute('title'), node.getAttribute('aria-label'), node.textContent]) {
        if (!value) continue;
        let text = normalize(value);
        for (const label of labels[type]) {
          if (text.endsWith(label)) { text = text.slice(0, -label.length).trim(); break; }
          if (text.startsWith(label)) { text = text.slice(label.length).trim(); break; }
        }
        const number = parseExactCount(text);
        if (number !== null) numbers.add(number);
      }
    }
    return numbers.size === 1 ? [...numbers][0] : null;
  }
  function matchesLabel(text, type) {
    const normalized = normalize(text);
    return labels[type].some(label => normalized === label ||
      new RegExp(`^(?:${count}\\s*${label}|${label}\\s*${count})$`, 'u').test(normalized));
  }
  function sameListHref(href, username, type) {
    try {
      const url = new URL(href, location.origin);
      return ['www.instagram.com', 'instagram.com'].includes(url.hostname) &&
        url.protocol === 'https:' && url.pathname.replace(/\/+$/, '') === `/${username}/${type}`;
    } catch { return false; }
  }
  function find(document, username, type) {
    const canonical = `/${username}/${type}/`;
    const links = Array.from(document.querySelectorAll('a'));
    // Keep the original exact-href choice and ordering when it is available.
    const original = links.find(link => link.getAttribute('href') === canonical);
    if (original) return original;
    const equivalent = links.find(link => sameListHref(link.getAttribute('href'), username, type));
    if (equivalent) return equivalent;
    const scope = document.querySelector('main, [role="main"]') || document;
    const candidates = new Set();
    for (const label of scope.querySelectorAll('a, button, [role="button"], [role="link"], span, li, div')) {
      if (label.closest('article, nav, aside, [role="navigation"], [role="dialog"], [hidden], [aria-hidden="true"]') ||
        !label.getClientRects().length || getComputedStyle(label).visibility === 'hidden') continue;
      if (![label.textContent, label.getAttribute('aria-label'), label.getAttribute('title')]
        .some(text => matchesLabel(text, type))) continue;
      // Click the site's native control. Bare label spans also dispatch a native
      // bubbling click to Instagram's enclosing event handler; no synthetic DOM links.
      const control = label.closest('a, button, [role="button"], [role="link"]') || label;
      const href = control.getAttribute('href');
      if (href && !href.startsWith('#') && !sameListHref(href, username, type)) continue;
      candidates.add(control);
    }
    // Nested label wrappers represent one control: choose the innermost match.
    const leaves = [...candidates].filter(control => ![...candidates].some(other =>
      other !== control && control.contains(other)));
    return leaves.length === 1 ? leaves[0] : null;
  }
  function forOriginal(document) {
    const links = Array.from(document.querySelectorAll('a'));
    const username = location.pathname.replace(/\//g, '');
    for (const type of ['following', 'followers']) {
      const canonical = `/${username}/${type}/`;
      if (links.some(link => link.getAttribute('href') === canonical)) continue;
      const control = find(document, username, type);
      if (!control) continue;
      // Only the original openList('a') lookup sees this wrapper. Its click is
      // bound to the actual Instagram control. Dialog collection remains native.
      links.push(new Proxy(control, {
        get(target, property) {
          if (property === 'getAttribute') return name => name === 'href' ? canonical : target.getAttribute(name);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      }));
    }
    return links;
  }
  return { find, forOriginal, parseExactCount, expectedCount };
})();
