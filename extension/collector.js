
globalThis.F4FCollector = (() => {
  const ROWS = 'a[role="link"][href^="/"]';
  const OPEN_MS = 3000, SETUP_MS = 2000, STEP_MS = 1500, CLOSE_MS = 2000;
  const STABLE_PASSES = 8;
  const RETRY_WAITS = [3000, 6000, 10000];
  const MAX_DIALOG_RECOVERIES = 4;
  const DIALOG_RECOVERY_MS = 3000;
  const LIST_LIMIT_MS = 20 * 60 * 1000;
  let username, active, counts, current, failureReason, lastProgress = 0;
  const reports = {};
  function failure(message, reason = 'incomplete_scan') {
    failureReason = reason;
    const error = new Error(message); error.reason = reason; return error;
  }
  function check() {
    if (!active?.() || F4FSelectors.usernameFromHref(location.href) !== username) {
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
  function addHref(href) {
    if (!href || !href.startsWith('/') || href.length <= 1) return;
    const name = href.split('/')[1].split('?')[0];
    if (name && !name.includes('/') && name !== 'explore' && name !== 'reels') current.users.add(name);
  }
  function capture(node) {
    if (node.nodeType !== 1) return;
    const row = anchor => {
      addHref(anchor.getAttribute('href'));
      if (current.area?.contains(anchor) && (!current.lastRow?.isConnected ||
        current.lastRow.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) current.lastRow = anchor;
    };
    if (node.matches(ROWS)) row(node);
    for (const anchor of node.querySelectorAll(ROWS)) row(anchor);
  }
  function mutations(records) {
    const before = current.users.size;
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches('a[role="link"]')) {
          if (record.attributeName === 'href') addHref(record.oldValue);
          capture(record.target);
        }
      } else if (record.type === 'childList') {
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
  async function until(predicate, timeout, message) {
    const end = Date.now() + timeout;
    while (!predicate()) {
      check();
      if (Date.now() >= end) throw failure(message, 'page_readiness');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  function scrollArea(dialog) {
    const areas = [...dialog.querySelectorAll('div')].filter(node => node.clientHeight > 0 &&
      (node.scrollHeight > node.clientHeight || /auto|scroll/.test(getComputedStyle(node).overflowY)));
    return areas.reduce((best, node) => !best || node.scrollHeight > best.scrollHeight ? node : best, null);
  }
  function observeDialog(dialog) {
    const scan = current;
    scan.observer?.disconnect();
    scan.dialog = dialog; scan.area = null; scan.lastRow = null;
    scan.observer = new MutationObserver(records => { if (current === scan) mutations(records); });
    scan.observer.observe(dialog, { subtree: true, childList: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['href', 'role', 'aria-busy'] });
  }
  async function ensureDialog() {
    if (current.dialog.isConnected) return;
    flush(); current.observer.disconnect();
    const message = 'The Instagram list disappeared and did not reopen. Retry checking.';
    if (++current.recoveries > MAX_DIALOG_RECOVERIES) throw failure(message, 'interrupted');
    const end = Date.now() + DIALOG_RECOVERY_MS;
    while (true) {
      check();
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) { observeDialog(dialog); return; }
      if (Date.now() >= end) throw failure(message, 'interrupted');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  function loading() {
    return [...current.dialog.querySelectorAll('[role="progressbar"], [aria-busy="true"]')]
      .some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  }
  function countError() {
    return failure(`Incomplete ${current.type} scan: collected ${current.users.size} of ${current.expected}. Instagram stopped loading accounts. Retry checking; no non-followers were confirmed.`);
  }
  function validateSize() {
    return current.users.size >= current.expected;
  }
  function step() {
    const area = current.area;
    const top = area.scrollTop;
    const height = area.clientHeight;
    const last = current.lastRow?.isConnected ? current.lastRow : null;
    const knownBottom = last ? last.getBoundingClientRect().bottom - area.getBoundingClientRect().top + top : top;
    const target = Math.min(area.scrollHeight - height, Math.max(top, knownBottom - height * .2));
    if (target <= top + 1) return false;
    area.scrollTop = Math.max(0, target);
    return true;
  }
  async function prepare(isActive) {
    dispose(); failureReason = null; active = isActive; username = F4FSelectors.usernameFromHref(location.href);
    counts = {};
    for (const type of ['following', 'followers']) {
      counts[type] = F4FListControls.expectedCount(document, username, type);
      if (counts[type] === null) throw failure(
        `Instagram did not expose an exact ${type} total. A rounded count cannot verify a complete scan. Reload your profile and retry.`, 'unverified_count');
    }
    if (document.querySelector('div[role="dialog"]')) throw failure('Close the open Instagram dialog and retry checking.', 'page_readiness');
  }
  async function open(type) {
    check();
    current = { type, expected: counts[type], users: new Set(), recoveries: 0, deadline: Date.now() + LIST_LIMIT_MS };
    progress(true);
    if (current.expected === 0) return;
    const control = F4FListControls.find(document, username, type);
    if (!control) throw failure(`Instagram’s ${type} control is unavailable. Reload your profile and retry.`, 'page_readiness');
    control.click();
    await until(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;
      observeDialog(dialog); return true;
    }, 15000, `Instagram’s ${type} dialog did not open. Retry checking.`);
    await wait(OPEN_MS);
  }
  async function collect() {
    check();
    if (current.expected === 0) { reports[current.type] = { expected: 0, collected: 0 }; return []; }
    await wait(SETUP_MS);
    let retries = 0, previousHeight = 0, previousSize = 0, noNewUsers = 0, stableLoops = 0;
    while (true) {
      check();
      if (!current.dialog.isConnected) { await ensureDialog(); stableLoops = 0; noNewUsers = 0; }
      if (!current.area?.isConnected) {
        current.area = scrollArea(current.dialog);
        current.lastRow = null;
        capture(current.area || current.dialog);
        stableLoops = 0;
      }
      flush();
      const area = current.area;
      const atEnd = !area || area.scrollTop + area.clientHeight >= area.scrollHeight - 2;
      const height = area?.scrollHeight || 0;
      if (current.users.size > previousSize) {
        retries = 0; current.recoveries = 0; noNewUsers = 0; stableLoops = 0;
      }
      if (height !== previousHeight) stableLoops = 0;
      if (stableLoops >= STABLE_PASSES && atEnd) {
        if (validateSize() && !loading()) break;
        if (retries >= RETRY_WAITS.length) throw countError();
        await wait(RETRY_WAITS[retries++]);
      } else {
        if (area) {
          if (atEnd) area.scrollTop = area.scrollHeight;
          else step();
        }
        await wait(STEP_MS);
      }
      flush();
      if (current.users.size === previousSize) noNewUsers++;
      else { noNewUsers = 0; retries = 0; current.recoveries = 0; }
      const afterHeight = current.area?.scrollHeight || 0;
      if (afterHeight === previousHeight && noNewUsers >= 3) stableLoops++;
      else stableLoops = 0;
      previousHeight = afterHeight; previousSize = current.users.size;
      progress();
    }
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
    current.observer?.disconnect();
    const end = Date.now() + 2500;
    while (current.dialog) {
      const dialog = current.dialog.isConnected ? current.dialog : document.querySelector('div[role="dialog"]');
      if (!dialog) break;
      current.dialog = dialog;
      if (Date.now() >= end) throw failure('Instagram’s list could not be closed. Close it and retry checking.', 'page_readiness');
      clickClose(dialog);
      await until(() => !dialog.isConnected, end - Date.now(), 'Instagram’s list could not be closed. Close it and retry checking.');
    }
    if (current.dialog) await wait(CLOSE_MS);
    current = null;
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
    if (current?.dialog?.isConnected) { try { clickClose(current.dialog); } catch {} }
    current = null;
    for (const type of ['following', 'followers']) delete reports[type];
  }
  return { prepare, open, collect, close, validation, dispose, get failureReason() { return failureReason; } };
})();
