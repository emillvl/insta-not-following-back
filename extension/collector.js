/* Validated DOM collection. The supplied checker and its comparison remain separate. */
globalThis.F4FCollector = (() => {
  const ROWS = 'a[role="link"][href^="/"]';
  const STEP_MS = 200;
  const RETRY_WAITS = [1500, 3000, 6000, 10000];
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
    // Preserve the original username extraction, exclusions, Set order and case.
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
    if (current.users.size !== before) progress();
    current.wake?.();
  }
  function flush() {
    if (current.observer) mutations(current.observer.takeRecords());
  }
  // One outstanding timer and one observer per list; no repeated full-list scans.
  function wait(ms, predicate = () => false) {
    check();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); if (current?.wake === wake) current.wake = null;
        try { check(); if (error) reject(error); else resolve(value); } catch (problem) { reject(problem); }
      };
      const wake = () => { try { if (predicate()) finish(true); } catch (error) { finish(false, error); } };
      const timer = setTimeout(() => { try { finish(predicate()); } catch (error) { finish(false, error); } }, ms);
      current.wake = wake;
      wake();
    });
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
  function loading() {
    return [...current.dialog.querySelectorAll('[role="progressbar"], [aria-busy="true"]')]
      .some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  }
  function countError() {
    return failure(`Incomplete ${current.type} scan: collected ${current.users.size} of ${current.expected}. Instagram stopped loading accounts. Retry checking; no non-followers were confirmed.`);
  }
  function validateSize() {
    if (current.users.size > current.expected) throw failure(
      `The ${current.type} count changed or unexpected rows appeared (${current.users.size} collected, ${current.expected} expected). Retry checking.`);
    return current.users.size === current.expected;
  }
  function step() {
    const area = current.area;
    const top = area.scrollTop;
    const height = area.clientHeight;
    // Jump across rows already captured, but never across an unseen virtual gap.
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
    current = { type, expected: counts[type], users: new Set(), deadline: Date.now() + LIST_LIMIT_MS };
    progress(true);
    if (current.expected === 0) return;
    const control = F4FListControls.find(document, username, type);
    if (!control) throw failure(`Instagram’s ${type} control is unavailable. Reload your profile and retry.`, 'page_readiness');
    control.click();
    await until(() => Boolean(document.querySelector('div[role="dialog"]')), 15000,
      `Instagram’s ${type} dialog did not open. Retry checking.`);
    current.dialog = document.querySelector('div[role="dialog"]');
    current.observer = new MutationObserver(mutations);
    current.observer.observe(current.dialog, { subtree: true, childList: true,
      attributes: true, attributeOldValue: true, attributeFilter: ['href', 'role', 'aria-busy'] });
  }
  async function collect() {
    check();
    if (current.expected === 0) { reports[current.type] = { expected: 0, collected: 0 }; return []; }
    let retries = 0;
    while (true) {
      check();
      if (!current.dialog.isConnected) throw failure('The Instagram list was closed during checking. Retry checking.', 'interrupted');
      if (!current.area?.isConnected) {
        current.area = scrollArea(current.dialog);
        current.lastRow = null;
        capture(current.area || current.dialog);
      }
      flush();
      if (validateSize() && !loading()) break;
      const before = current.users.size;
      const area = current.area;
      const beforeHeight = area?.scrollHeight || 0;
      const atEnd = !area || area.scrollTop + area.clientHeight >= area.scrollHeight - 2;
      if (!atEnd && step()) {
        // Keep a modest cadence while traversing already loaded rows.
        await wait(STEP_MS);
      } else {
        if (retries >= RETRY_WAITS.length) throw countError();
        // Retry only when no new accounts arrive. Fast responses wake this wait immediately.
        if (area && atEnd) {
          area.scrollTop = Math.max(0, area.scrollTop - 1);
          area.scrollTop = area.scrollHeight;
        }
        await wait(RETRY_WAITS[retries++], () => current.users.size > before || (validateSize() && !loading()) ||
          Boolean(current.area && current.area.scrollHeight > beforeHeight));
      }
      flush();
      if (current.users.size > before) retries = 0;
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
    if (current.dialog?.isConnected) {
      clickClose(current.dialog);
      await until(() => !current.dialog.isConnected, 2500, 'Instagram’s list could not be closed. Close it and retry checking.');
    }
    current = null;
  }
  function validation() {
    check();
    for (const type of ['following', 'followers']) {
      if (!reports[type] || F4FListControls.expectedCount(document, username, type) !== counts[type]) {
        throw failure('Your profile counts changed during checking. Retry to get a consistent result.');
      }
    }
    return { verified: true, following: { ...reports.following }, followers: { ...reports.followers } };
  }
  function dispose() {
    current?.observer?.disconnect();
    if (current?.dialog?.isConnected) { try { clickClose(current.dialog); } catch { /* Best-effort owned-dialog cleanup. */ } }
    current = null;
    for (const type of ['following', 'followers']) delete reports[type];
  }
  return { prepare, open, collect, close, validation, dispose, get failureReason() { return failureReason; } };
})();
