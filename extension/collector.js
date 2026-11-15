
globalThis.F4FCollector = (() => {
  const ROWS = 'a[href]';
  const DIALOG = '[role="dialog"]';
  const HIDDEN = '[hidden], [aria-hidden="true"]';
  const OPEN_MS = 3000, SETUP_MS = 2000, STEP_MS = 1500, CLOSE_MS = 2000;
  const STABLE_PASSES = 8;
  const SCROLL_STALL_MS = 3 * STEP_MS;
  const SCROLL_GAP_MS = STABLE_PASSES * STEP_MS;
  const RECHECK_MS = 45000;
  const LOAD_STALL_MS = 90000;
  const MAX_DIALOG_RECOVERIES = 4;
  const DIALOG_RECOVERY_MS = 3000;
  const LIST_LIMIT_MS = 20 * 60 * 1000;
  let username, active, counts, current, lastFailure, lastProgress = 0;
  const reports = {};
  function failure(message, reason = 'incomplete_scan') {
    lastFailure = new Error(message);
    lastFailure.reason = reason;
    return lastFailure;
  }
  function check() {
    const route = current && F4FSelectors.listFromHref(location.href);
    if (!active?.() || (F4FSelectors.usernameFromHref(location.href) !== username &&
      !(route?.username === username && route?.type === current?.type))) {
      throw failure('Checking was interrupted. Return to your profile and retry.', 'interrupted');
    }
    if (current && Date.now() > current.deadline) {
      throw failure(`The ${current.type} scan reached its time limit (${current.users.size} of ${current.expected} collected). Retry checking.`);
    }
  }
  function progress(force = false) {
    if (!current || (!force && Date.now() - lastProgress < 1000)) return;
    lastProgress = Date.now();
    void F4FBridge.progress?.(current.type, current.users.size, current.expected);
  }
  function accountName(anchor, href = anchor.getAttribute('href'), knownRow = false) {
    if (!href || anchor.closest(HIDDEN)) return null;
    const name = F4FSelectors.usernameFromHref(href, document.baseURI);
    if (!name || name.toLowerCase() === username.toLowerCase()) return null;
    if (knownRow || anchor.getAttribute('role') === 'link') return name;
    const handle = name.toLowerCase();
    const matches = label => label?.trim().replace(/^@/, '').toLowerCase() === handle;
    const labeled = node => [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')].some(matches);
    return labeled(anchor) || [...anchor.querySelectorAll('span, strong, [aria-label], [title]')]
      .some(node => !node.closest(HIDDEN) && labeled(node)) ? name : null;
  }
  function captureScope() {
    if (current.area) return current.dialog.contains(current.area) ? current.area : current.dialog;
    return current.hasViewport ? null : current.dialog;
  }
  function capture(node) {
    if (node?.nodeType !== 1) return;
    const row = anchor => {
      const name = accountName(anchor);
      if (!name) return;
      current.accountLinks.add(anchor);
      current.users.add(name);
      if (current.area?.contains(anchor) && (!current.area.contains(current.lastRow) ||
        current.lastRow.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) current.lastRow = anchor;
    };
    if (node.matches(ROWS)) row(node);
    for (const anchor of node.querySelectorAll(ROWS)) row(anchor);
  }
  function mutations(records) {
    const scope = captureScope();
    if (!scope) return;
    const before = current.users.size;
    for (const record of records) {
      if (!scope.contains(record.target)) continue;
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const anchor = element?.closest(ROWS);
      if (record.type === 'attributes') {
        if (record.attributeName === 'href' && element.matches('a')) {
          const oldName = accountName(element, record.oldValue, current.accountLinks.has(element));
          if (oldName) current.users.add(oldName);
        }
        if (record.attributeName === 'hidden' || record.attributeName === 'aria-hidden') capture(element);
      }
      capture(anchor);
      if (record.type === 'childList') {
        for (const node of record.addedNodes) capture(node);
        for (const node of record.removedNodes) capture(node);
      }
    }
    if (current.users.size !== before) { current.recoveries = 0; progress(); }
  }
  function flush() {
    if (current.observer) mutations(current.observer.takeRecords());
  }
  async function wait(ms) {
    check();
    await new Promise(resolve => setTimeout(resolve, ms));
    check();
  }
  async function waitForInstagram() {
    let retryAt = F4FBridge.retryAt || 0;
    const wasWaiting = retryAt > Date.now();
    for (let remaining = retryAt - Date.now(); remaining > 0; remaining = retryAt - Date.now()) {
      if (retryAt >= current.deadline) {
        throw failure(`Instagram’s cooldown exceeds the time left to check ${current.type} (${current.users.size} of ${current.expected} collected). Retry after ${new Date(retryAt).toLocaleString()}.`, 'rate_limited');
      }
      await wait(Math.min(STEP_MS, remaining));
      retryAt = F4FBridge.retryAt || 0;
    }
    if (wasWaiting) progress(true);
    return retryAt;
  }
  async function until(predicate, timeout, message) {
    const end = Date.now() + timeout;
    while (!predicate()) {
      check();
      if (Date.now() >= end) throw failure(message, 'page_readiness');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  function scrollArea(dialog) {
    const inspected = new Map(), areas = new Map();
    for (const anchor of dialog.querySelectorAll(ROWS)) {
      const name = accountName(anchor);
      if (!name) continue;
      let viewport, clipped, declared;
      for (let node = anchor.parentElement; node; node = node.parentElement) {
        if (!inspected.has(node)) {
          const height = node.clientHeight;
          inspected.set(node, { overflow: height ? getComputedStyle(node).overflowY : '',
            canMove: height > 0 && node.scrollHeight > height });
        }
        const { overflow, canMove } = inspected.get(node);
        if (/^(auto|scroll|overlay)$/.test(overflow)) {
          if (canMove) { viewport = node; break; }
          declared ??= node;
        }
        if (overflow === 'hidden' && canMove) clipped ??= node;
        if (node === dialog) break;
      }
      const area = viewport || clipped || declared;
      if (area) {
        if (!areas.has(area)) areas.set(area, new Set());
        areas.get(area).add(name);
      }
    }
    let best = null, most = 0;
    for (const [node, accounts] of areas) {
      if (accounts.size > most) { best = node; most = accounts.size; }
    }
    const page = current.inline && document.scrollingElement;
    if (!best && page && page.scrollHeight > page.clientHeight) return page;
    return best;
  }
  function bindArea(area) {
    if (area && !current.hasViewport) {
      current.users.clear();
      current.accountLinks = new WeakSet();
      current.hasViewport = true;
    }
    current.area = area;
    current.lastRow = null;
  }
  function observeDialog(dialog) {
    const scan = current;
    scan.observer?.disconnect();
    scan.dialog = dialog;
    scan.inline = !dialog.matches(DIALOG);
    bindArea(scrollArea(dialog));
    if (scan.area) capture(captureScope());
    scan.observer = new MutationObserver(records => { if (current === scan) mutations(records); });
    scan.observer.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['href', 'role', 'aria-label', 'hidden', 'aria-hidden'] });
  }
  async function ensureDialog() {
    if (F4FSelectors.visible(current.dialog)) return;
    flush(); current.observer.disconnect();
    const message = 'The Instagram list disappeared and did not reopen. Retry checking.';
    if (++current.recoveries > MAX_DIALOG_RECOVERIES) throw failure(message, 'interrupted');
    const end = Date.now() + DIALOG_RECOVERY_MS;
    while (true) {
      check();
      const dialog = listView(current.direct);
      if (dialog) { observeDialog(dialog); return; }
      if (Date.now() >= end) throw failure(message, 'interrupted');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  function listTitle(root, type) {
    return F4FListControls.matchesLabel(root.getAttribute('aria-label'), type) ||
      [...root.querySelectorAll('h1, h2, h3, [role="heading"]')].some(heading =>
        F4FSelectors.visible(heading) && F4FListControls.matchesLabel(heading.textContent, type));
  }
  function listView(direct) {
    const dialogs = [...document.querySelectorAll(DIALOG)].filter(F4FSelectors.visible);
    const named = dialogs.find(dialog => listTitle(dialog, current.type));
    if (named) return named;
    const other = current.type === 'following' ? 'followers' : 'following';
    if (dialogs.length) return dialogs.length === 1 && !listTitle(dialogs[0], other) ? dialogs[0] : null;
    if (!direct || !F4FSelectors.listFromHref(location.href)) return null;
    for (const main of document.querySelectorAll('main, [role="main"]')) {
      if (listTitle(main, current.type)) return main;
    }
    return null;
  }
  function viewportTop(area) {
    return area === document.scrollingElement ? 0 : area.getBoundingClientRect().top + area.clientTop;
  }
  function loading(area) {
    const selector = '[role="progressbar"], [aria-busy="true"]';
    const nodes = [...current.dialog.querySelectorAll(selector)];
    if (current.dialog.matches(selector)) nodes.push(current.dialog);
    return nodes.some(node => {
      if (!node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
      if (!area?.contains(node) || node.matches('[aria-busy="true"]')) return true;
      const top = viewportTop(area);
      const bounds = node.getBoundingClientRect();
      return bounds.bottom > top && bounds.top < top + area.clientHeight;
    });
  }
  function countError(triedDirectPage = false) {
    const list = current.type === 'following' ? 'accounts you follow' : 'followers';
    if (validateSize()) return failure(`Instagram’s ${current.type} list did not finish loading. No comparison was made.`);
    const attempt = triedDirectPage ? ` after trying Instagram’s /${current.type}/ page` : '';
    return failure(`F4F Checker verified ${current.users.size} of ${current.expected} ${list}${attempt}. No comparison was made.`);
  }
  function validateSize() {
    return current.users.size >= current.expected;
  }
  function step(blockedFor) {
    const area = current.area;
    const top = area.scrollTop;
    const height = area.clientHeight;
    const last = area.contains(current.lastRow) ? current.lastRow : null;
    const knownBottom = last ? last.getBoundingClientRect().bottom - viewportTop(area) + top : top;
    let next = knownBottom - height * .2;
    if (next <= top + 1) {
      if (blockedFor >= SCROLL_STALL_MS && knownBottom > top + 2) next = knownBottom - 1;
      else if (blockedFor >= SCROLL_GAP_MS) next = top + height * .75;
    }
    const target = Math.min(area.scrollHeight - height, next);
    if (target <= top + 1) return false;
    area.scrollTop = Math.max(0, target);
    return true;
  }
  async function prepare(isActive) {
    dispose(); lastFailure = null; active = isActive; username = F4FSelectors.usernameFromHref(location.href);
    counts = {};
    for (const type of ['following', 'followers']) {
      counts[type] = F4FListControls.expectedCount(document, username, type);
      if (counts[type] === null) throw failure(
        `Instagram’s ${type} total could not be verified. An exact total is needed before comparing the lists.`, 'unverified_count');
    }
    if ([...document.querySelectorAll(DIALOG)].some(F4FSelectors.visible)) {
      throw failure('Close the open Instagram dialog and retry checking.', 'page_readiness');
    }
  }
  async function open(type) {
    check();
    current = { type, expected: counts[type], users: new Set(), accountLinks: new WeakSet(),
      recoveries: 0, deadline: Date.now() + LIST_LIMIT_MS };
    progress(true);
    if (current.expected === 0) return;
    try { await openDialog(); }
    catch (error) {
      if (error.reason !== 'page_readiness' || !F4FBridge.recoverList) throw error;
    }
  }
  function clickListControl(control) {
    const link = control.closest('a[href]');
    const cancelDefault = event => { if (event.composedPath().includes(link)) event.preventDefault(); };
    if (link && F4FSelectors.listFromHref(link.href)) window.addEventListener('click', cancelDefault);
    try { control.click(); } finally { window.removeEventListener('click', cancelDefault); }
  }
  async function openDialog() {
    const { type } = current;
    let clickedAfter = -1, openingDeadline = 0;
    while (true) {
      check();
      const retryAt = await waitForInstagram();
      let dialog = listView(false);
      if (!dialog && retryAt > clickedAfter) {
        const control = F4FListControls.find(document, username, type);
        if (!control) throw failure(`Instagram’s ${type} control is unavailable. Reload your profile and retry.`, 'page_readiness');
        clickedAfter = retryAt;
        openingDeadline = Date.now() + 15000;
        clickListControl(control);
        dialog = listView(false);
      }
      if (dialog) {
        current.handledLimit = clickedAfter;
        observeDialog(dialog);
        await wait(OPEN_MS);
        return;
      }
      if (Date.now() >= openingDeadline) throw failure(`Instagram’s ${type} dialog did not open. Retry checking.`, 'page_readiness');
      await wait(100);
    }
  }
  async function readListPage({ username: profile, list, expected, deadline }, isActive) {
    active = isActive;
    username = profile;
    current = { type: list, expected, deadline, users: new Set(), accountLinks: new WeakSet(), recoveries: 0, direct: true };
    try {
      await waitForInstagram();
      if (F4FSelectors.usernameFromHref(location.href) === username) {
        await until(() => (F4FSelectors.currentOwnProfile(document) || F4FSelectors.ownProfile(document)) === username,
          15000, 'Instagram did not show your own profile after redirecting from the list page.');
        await openDialog();
      } else {
        await until(() => listView(true), 15000, 'Instagram did not show the list at its direct address.');
        observeDialog(listView(true));
        current.handledLimit = F4FBridge.retryAt || 0;
        await wait(OPEN_MS);
      }
      return await collect();
    } finally {
      current?.observer?.disconnect();
      current = null;
    }
  }
  async function recoverList() {
    if (current.direct || !F4FBridge.recoverList) throw lastFailure || countError();
    await closeDialog();
    await waitForInstagram();
    const result = await F4FBridge.recoverList(current.type, current.expected, current.users.size, current.deadline);
    check();
    if (result?.reason === 'rate_limited') throw failure(result.message, result.reason);
    for (const name of result?.accounts || []) current.users.add(name);
    if (!validateSize()) throw countError(true);
    return finishList();
  }
  async function collect() {
    check();
    if (current.expected === 0) { reports[current.type] = { expected: 0, collected: 0 }; return []; }
    if (!current.dialog) return recoverList();
    await wait(SETUP_MS);
    let previousHeight = 0, previousSize = 0, noNewUsers = 0, stableLoops = 0;
    let stalledAt = null, blockedAt = null, rechecked = false, resumedFromLimit = false;
    while (true) {
      check();
      const retryAt = await waitForInstagram();
      if (retryAt > current.handledLimit) {
        current.handledLimit = retryAt;
        resumedFromLimit = true; rechecked = false;
        stalledAt = null; blockedAt = null; noNewUsers = 0; stableLoops = 0;
      }
      if (!F4FSelectors.visible(current.dialog)) { await ensureDialog(); stableLoops = 0; noNewUsers = 0; }
      const ownsArea = current.dialog.contains(current.area) || (current.inline && current.area === document.scrollingElement);
      if (!ownsArea || !current.area.contains(current.lastRow) ||
        current.area.scrollHeight <= current.area.clientHeight) {
        const area = scrollArea(current.dialog);
        if (area !== current.area) { bindArea(area); stableLoops = 0; blockedAt = null; }
        capture(captureScope());
      }
      flush();
      const area = current.area;
      const height = area?.scrollHeight || 0;
      const bottom = area ? height - area.clientHeight : 0;
      const top = area?.scrollTop || 0;
      const atEnd = area ? top >= bottom - 2 : !current.hasViewport;
      const pending = loading(area);
      if (current.users.size > previousSize) {
        stalledAt = null; rechecked = false; resumedFromLimit = false;
        current.recoveries = 0; noNewUsers = 0; stableLoops = 0;
      }
      if (height !== previousHeight) stableLoops = 0;
      if (stableLoops >= STABLE_PASSES && atEnd && !pending && validateSize()) break;

      const now = Date.now();
      let moved = false;
      if (area && top < bottom) {
        if (!atEnd) moved = step(pending ? 0 : now - (blockedAt ?? now));
        else if (!pending) { area.scrollTop = bottom; moved = true; }
        blockedAt = moved ? null : blockedAt ?? now;
      } else blockedAt = null;

      if (!moved && stableLoops >= STABLE_PASSES) {
        stalledAt ??= now;
        const stalledFor = now - stalledAt;
        if (stalledFor >= LOAD_STALL_MS) {
          if (current.direct && atEnd && !pending) return finishList();
          if (!current.direct && !validateSize() && F4FBridge.recoverList) return recoverList();
          throw countError();
        }
        if (!rechecked && (resumedFromLimit || stalledFor >= RECHECK_MS)) {
          if (!pending && atEnd && area && top > 2) {
            rechecked = true; resumedFromLimit = false;
            area.scrollTop = 0;
          } else if (!current.inline && (!area || bottom <= 2) && !validateSize() &&
            (!pending || (resumedFromLimit && stalledFor >= RECHECK_MS))) {
            rechecked = true; resumedFromLimit = false;
            await closeDialog();
            await openDialog();
            await wait(SETUP_MS);
            noNewUsers = 0; stableLoops = 0; blockedAt = null;
          }
        }
      }
      await wait(STEP_MS);
      flush();
      if (current.users.size === previousSize) noNewUsers++;
      else {
        noNewUsers = 0; stalledAt = null; rechecked = false; resumedFromLimit = false;
        current.recoveries = 0;
      }
      const afterHeight = current.area?.scrollHeight || 0;
      if (afterHeight === previousHeight && noNewUsers >= 3) stableLoops++;
      else stableLoops = 0;
      previousHeight = afterHeight; previousSize = current.users.size;
      progress();
    }
    return finishList();
  }
  function finishList() {
    reports[current.type] = { expected: current.expected, collected: current.users.size };
    progress(true);
    return [...current.users];
  }
  function clickClose(dialog) {
    for (const label of F4FSelectors.closeLabels) {
      const node = dialog.querySelector(`button[aria-label="${label}"], svg[aria-label="${label}"]`);
      if (node) { (node.closest('button, [role="button"]') || node.parentElement).click(); return; }
    }
    dialog.parentElement?.click();
  }
  async function close() {
    if (!current) return;
    await closeDialog();
    const finished = current.type === 'followers';
    current = null;
    if (finished) validation();
  }
  async function closeDialog() {
    current.observer?.disconnect();
    if (current.inline) return;
    const end = Date.now() + 2500;
    while (current.dialog) {
      const dialog = F4FSelectors.visible(current.dialog) ? current.dialog : listView(false);
      if (!dialog) break;
      current.dialog = dialog;
      if (Date.now() >= end) throw failure('Instagram’s list could not be closed. Close it and retry checking.', 'page_readiness');
      clickClose(dialog);
      await until(() => !F4FSelectors.visible(dialog), end - Date.now(), 'Instagram’s list could not be closed. Close it and retry checking.');
    }
    if (current.dialog) await wait(CLOSE_MS);
    current.dialog = null;
  }
  function validation() {
    check();
    for (const type of ['following', 'followers']) {
      if (!reports[type] || F4FListControls.expectedCount(document, username, type) !== counts[type]) {
        throw failure('Your profile counts changed during checking. Retry to get a consistent result.');
      }
    }
    return { verified: true, settled: true, following: { ...reports.following }, followers: { ...reports.followers } };
  }
  function dispose() {
    current?.observer?.disconnect();
    if (current?.dialog && !current.inline && F4FSelectors.visible(current.dialog)) { try { clickClose(current.dialog); } catch {} }
    current = null;
    for (const type of ['following', 'followers']) delete reports[type];
  }
  return { prepare, open, collect, close, readListPage, validation, dispose, get lastFailure() { return lastFailure; } };
})();
