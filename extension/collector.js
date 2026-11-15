
globalThis.F4FCollector = (() => {
  const ROWS = 'a[href]';
  const DIALOG = '[role="dialog"]';
  const HIDDEN = '[hidden], [aria-hidden="true"]';
  const OPEN_MS = 3000, SETUP_MS = 2000, STEP_MS = 1500, CLOSE_MS = 2000;
  const STABLE_PASSES = 8;
  const SCROLL_STALL_MS = 3 * STEP_MS;
  const SCROLL_GAP_MS = STABLE_PASSES * STEP_MS;
  const BUSY_REOPEN_MS = 45000;
  const LOAD_STALL_MS = 90000;
  const MAX_DIALOG_RECOVERIES = 4;
  const DIALOG_RECOVERY_MS = 3000;
  const LIST_LIMIT_MS = 20 * 60 * 1000;
  const MAX_EXACT_SEARCHES = 14;
  const VERIFYING = 'data-f4f-verifying';
  const SEARCH_FIELDS = 'input[type="search"], input[type="text"], input:not([type])';
  const INACTIVE_LABELS = new Set(['deactivated account', 'deactivated']);
  const RELATIONSHIPS = {
    following: new Map([
      ['following', true], ['takiptesin', true], ['takip ediliyor', true],
      ['follow', false], ['follow back', false], ['requested', false],
      ['takip et', false], ['geri takip et', false], ['istek gönderildi', false]
    ]),
    followers: new Map([['remove', true], ['follows you', true], ['kaldır', true], ['seni takip ediyor', true]])
  };
  let username, active, counts, current, lastFailure, lastProgress = 0;
  const lists = {};
  const inertDialogs = new Set();
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
    const name = F4FSelectors.usernameFromHref(href, document.baseURI)?.toLowerCase();
    if (!name || name === username.toLowerCase()) return null;
    if (knownRow || anchor.getAttribute('role') === 'link') return name;
    const matches = label => label?.trim().replace(/^@/, '').toLowerCase() === name;
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
      current.evidenceDirty = true;
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
    return best;
  }
  function bindArea(area) {
    if (area && !current.hasViewport) {
      current.users.clear();
      current.evidence.clear();
      current.accountLinks = new WeakSet();
      current.hasViewport = true;
    }
    current.area = area;
    current.lastRow = null;
    current.evidenceDirty = true;
  }
  function observeDialog(dialog) {
    const scan = current;
    scan.observer?.disconnect();
    scan.dialog = dialog;
    bindArea(scrollArea(dialog));
    if (scan.area) capture(captureScope());
    scan.observer = new MutationObserver(records => { if (current === scan) mutations(records); });
    scan.observer.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['href', 'role', 'aria-label', 'title', 'hidden', 'aria-hidden'] });
  }
  async function ensureDialog() {
    if (F4FSelectors.visible(current.dialog)) return;
    flush(); current.observer.disconnect();
    const message = 'The Instagram list disappeared and did not reopen. Retry checking.';
    if (++current.recoveries > MAX_DIALOG_RECOVERIES) throw failure(message, 'interrupted');
    const end = Date.now() + DIALOG_RECOVERY_MS;
    while (true) {
      check();
      const dialog = listView();
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
  function listView() {
    const dialogs = [...document.querySelectorAll(DIALOG)].filter(F4FSelectors.visible);
    const named = dialogs.find(dialog => listTitle(dialog, current.type));
    if (named) return named;
    const other = current.type === 'following' ? 'followers' : 'following';
    return dialogs.length === 1 && !listTitle(dialogs[0], other) ? dialogs[0] : null;
  }
  function loading(area) {
    const selector = '[role="progressbar"], [aria-busy="true"]';
    const nodes = [...current.dialog.querySelectorAll(selector)];
    if (current.dialog.matches(selector)) nodes.push(current.dialog);
    return nodes.some(node => {
      if (!node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
      if (!area?.contains(node) || node.matches('[aria-busy="true"]')) return true;
      const top = area.getBoundingClientRect().top + area.clientTop;
      const bounds = node.getBoundingClientRect();
      return bounds.bottom > top && bounds.top < top + area.clientHeight;
    });
  }
  function countError(type, collected, expected) {
    const list = type === 'following' ? 'accounts you follow' : 'followers';
    if (collected >= expected) return failure(`Instagram’s ${type} list did not finish loading. No comparison was made.`);
    return failure(`F4F Checker verified ${collected} of ${expected} ${list}. No comparison was made.`);
  }
  function validateSize() {
    return current.users.size >= current.expected;
  }
  function recordState(states, name, state) {
    const previous = states.get(name);
    if (previous === undefined || state === 'inactive') states.set(name, state);
    else if (previous !== 'inactive' && previous !== state) states.set(name, null);
  }
  function relationshipStates(scope, labels) {
    const states = new Map();
    for (const control of scope.querySelectorAll('button, [role="button"], [role="status"]')) {
      const values = [control.innerText ?? control.textContent, control.getAttribute('aria-label'), control.getAttribute('title')]
        .map(text => text?.trim().toLowerCase().replace(/\u0307/g, ''));
      const state = values.some(text => INACTIVE_LABELS.has(text)) ? 'inactive' :
        labels?.get(values.find(text => labels.has(text)));
      if (state === undefined || control.closest('header, nav, [role="tab"]') || !F4FSelectors.visible(control)) continue;
      for (let row = control.parentElement; row && row !== scope; row = row.parentElement) {
        if (row.querySelector(SEARCH_FIELDS)) break;
        const names = new Set([...row.querySelectorAll(ROWS)].map(anchor => accountName(anchor)).filter(Boolean));
        if (names.size === 1) recordState(states, names.values().next().value, state);
        if (names.size) break;
      }
    }
    return states;
  }
  function rememberEvidence() {
    const following = current.type === 'following';
    if (!current.evidenceDirty || (!following && lists.following.accounts.length >= counts.following)) return;
    current.evidenceDirty = false;
    const scope = captureScope();
    if (!scope) return;
    const labels = following ? undefined : RELATIONSHIPS.following;
    for (const [name, state] of relationshipStates(scope, labels)) recordState(current.evidence, name, state);
  }
  function step(blockedFor) {
    const area = current.area;
    const top = area.scrollTop;
    const height = area.clientHeight;
    const last = area.contains(current.lastRow) ? current.lastRow : null;
    const knownBottom = last ? last.getBoundingClientRect().bottom - area.getBoundingClientRect().top - area.clientTop + top : top;
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
    current = { type, expected: counts[type], users: new Set(), accountLinks: new WeakSet(), evidence: new Map(),
      recoveries: 0, deadline: Date.now() + LIST_LIMIT_MS };
    progress(true);
    if (current.expected > 0) await openDialog();
  }
  function clickListControl(control) {
    const link = control.closest('a[href]');
    const cancelDefault = event => { if (event.composedPath().includes(link)) event.preventDefault(); };
    if (link && F4FSelectors.listFromHref(link.href)) window.addEventListener('click', cancelDefault);
    try { control.click(); } finally { window.removeEventListener('click', cancelDefault); }
  }
  async function openDialog(observe = true) {
    const { type } = current;
    let clickedAfter = -1, openingDeadline = 0;
    while (true) {
      check();
      const retryAt = await waitForInstagram();
      let dialog = listView();
      if (!dialog && retryAt > clickedAfter) {
        const control = F4FListControls.find(document, username, type);
        if (!control) throw failure(`Instagram’s ${type} control is unavailable. Reload your profile and retry.`, 'page_readiness');
        clickedAfter = retryAt;
        openingDeadline = Date.now() + 15000;
        clickListControl(control);
        dialog = listView();
      }
      if (dialog) {
        current.handledLimit = clickedAfter;
        if (observe) observeDialog(dialog);
        else {
          current.dialog = dialog;
          concealDialog(dialog);
        }
        await wait(OPEN_MS);
        return;
      }
      if (Date.now() >= openingDeadline) throw failure(`Instagram’s ${type} dialog did not open. Retry checking.`, 'page_readiness');
      await wait(100);
    }
  }
  async function collect() {
    check();
    if (current.expected === 0) return finishList();
    await wait(SETUP_MS);
    let previousHeight = 0, previousSize = 0, noNewUsers = 0, stableLoops = 0;
    let stalledAt = null, blockedAt = null, quietEndAt = null, rechecked = false, resumedFromLimit = false;
    while (true) {
      check();
      const retryAt = await waitForInstagram();
      if (retryAt > current.handledLimit) {
        current.handledLimit = retryAt;
        resumedFromLimit = true; rechecked = false;
        stalledAt = null; blockedAt = null; noNewUsers = 0; stableLoops = 0;
      }
      if (!F4FSelectors.visible(current.dialog)) { await ensureDialog(); stableLoops = 0; noNewUsers = 0; }
      if (!current.dialog.contains(current.area) || !current.area.contains(current.lastRow) ||
        current.area.scrollHeight <= current.area.clientHeight) {
        const area = scrollArea(current.dialog);
        if (area !== current.area) { bindArea(area); stableLoops = 0; blockedAt = null; }
        capture(captureScope());
      }
      flush();
      rememberEvidence();
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

      if (moved || stableLoops < STABLE_PASSES) {
        stalledAt = null;
        quietEndAt = null;
      } else {
        stalledAt ??= now;
        const stalledFor = now - stalledAt;
        const settled = atEnd && !pending;
        const reopen = !rechecked && bottom <= 2 && !current.users.size &&
          (settled || (resumedFromLimit && stalledFor >= BUSY_REOPEN_MS));
        if (reopen) {
          rechecked = true; resumedFromLimit = false;
          await closeDialog();
          await openDialog();
          await wait(SETUP_MS);
          noNewUsers = 0; stableLoops = 0; blockedAt = null;
        } else if (settled && !rechecked && top > 2) {
          rechecked = true; resumedFromLimit = false;
          area.scrollTop = 0;
          quietEndAt = null;
        } else if (settled) {
          quietEndAt ??= now;
          if (now - quietEndAt >= SCROLL_STALL_MS) break;
        } else {
          quietEndAt = null;
          if (stalledFor >= LOAD_STALL_MS) throw countError(current.type, current.users.size, current.expected);
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
    const accounts = [...current.users];
    const list = { accounts, deadline: current.deadline, evidence: current.evidence };
    if (accounts.length < current.expected) list.searchable = Boolean(searchField(current.dialog));
    lists[current.type] = list;
    progress(true);
    return accounts;
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
    if (current.type === 'followers') {
      await reconcileLists();
      validation();
    } else {
      await closeDialog();
      current = null;
    }
  }
  async function closeDialog() {
    current.observer?.disconnect();
    const end = Date.now() + 2500;
    while (current.dialog) {
      const dialog = F4FSelectors.visible(current.dialog) ? current.dialog : listView();
      if (!dialog) break;
      current.dialog = dialog;
      if (Date.now() >= end) throw failure('Instagram’s list could not be closed. Close it and retry checking.', 'page_readiness');
      clickClose(dialog);
      await until(() => !F4FSelectors.visible(dialog), end - Date.now(), 'Instagram’s list could not be closed. Close it and retry checking.');
    }
    if (current.dialog) await wait(CLOSE_MS);
    current.dialog = null;
  }
  function concealDialog(dialog) {
    if (dialog.inert) return;
    dialog.inert = true;
    inertDialogs.add(dialog);
  }
  function searchField(dialog) {
    const fields = [...dialog.querySelectorAll(SEARCH_FIELDS)]
      .filter(input => !input.disabled && !input.readOnly && F4FSelectors.visible(input));
    const search = fields.filter(input => input.type === 'search' || input.getAttribute('role') === 'searchbox' ||
      ['search', 'ara'].includes((input.getAttribute('aria-label') || input.placeholder).trim().toLowerCase()));
    if (search.length === 1) return search[0];
    return fields.length === 1 ? fields[0] : null;
  }
  async function searchExact(input, name) {
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    value.set.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    let quietPasses = 0, busySince = null;
    while (quietPasses < 4) {
      await wait(STEP_MS);
      await waitForInstagram();
      const dialog = listView();
      if (!dialog || searchField(dialog)?.value.toLowerCase() !== name) return null;
      current.dialog = dialog;
      concealDialog(dialog);
      const area = scrollArea(dialog);
      if (loading(area)) {
        busySince ??= Date.now();
        if (Date.now() - busySince >= LOAD_STALL_MS) return null;
        continue;
      }
      busySince = null;
      quietPasses++;
      const state = relationshipStates(area || dialog, RELATIONSHIPS[current.type]).get(name);
      if (state === 'inactive') return false;
      if (state === true || state === false) return state;
    }
    return false;
  }
  function verificationCandidates(type) {
    const list = lists[type];
    if (list.accounts.length >= counts[type]) return [];
    const other = lists[type === 'following' ? 'followers' : 'following'];
    const existing = new Set(list.accounts);
    const candidates = [];
    for (const name of other.accounts) {
      if (existing.has(name)) continue;
      const state = other.evidence.get(name);
      if (state === true) list.accounts.push(name);
      else if (state !== 'inactive' && state !== false) candidates.push(name);
    }
    const missing = counts[type] - list.accounts.length;
    if (missing <= 0) return [];
    return list.searchable && candidates.length >= missing && candidates.length <= MAX_EXACT_SEARCHES &&
      Date.now() < list.deadline ? candidates : null;
  }
  async function verifyCandidates(candidates) {
    current.observer?.disconnect();
    const list = lists[current.type];
    let searches = 0;
    for (const [index, name] of candidates.entries()) {
      if (candidates.length - index < current.expected - list.accounts.length) break;
      await waitForInstagram();
      const dialog = listView();
      const input = dialog && searchField(dialog);
      if (!input) break;
      current.dialog = dialog;
      concealDialog(dialog);
      searches++;
      const confirmed = await searchExact(input, name);
      if (confirmed === null) break;
      if (!confirmed) continue;
      list.accounts.push(name);
      current.users.add(name);
      progress(true);
      if (validateSize()) break;
    }
    return searches;
  }
  async function reconcileLists() {
    const following = verificationCandidates('following');
    const followers = verificationCandidates('followers');
    let searches = 0;
    if (following && followers?.length) {
      document.documentElement.setAttribute(VERIFYING, '');
      searches = await verifyCandidates(followers);
    }
    await closeDialog();
    current = null;
    if (!following?.length || searches + following.length > MAX_EXACT_SEARCHES ||
      lists.followers.accounts.length < counts.followers) return;

    verifyProfileTotals();
    await wait(CLOSE_MS);
    document.documentElement.setAttribute(VERIFYING, '');
    current = { type: 'following', expected: counts.following, users: new Set(lists.following.accounts),
      deadline: lists.following.deadline };
    try {
      await openDialog(false);
      await wait(SETUP_MS);
      await verifyCandidates(following);
    } catch (error) {
      if (error.reason !== 'page_readiness') throw error;
    }
    await closeDialog();
    current = null;
  }
  function verifyProfileTotals() {
    check();
    for (const type of ['following', 'followers']) {
      if (!lists[type] || F4FListControls.expectedCount(document, username, type) !== counts[type]) {
        throw failure('Your profile counts changed during checking. Retry to get a consistent result.');
      }
    }
  }
  function validation() {
    verifyProfileTotals();
    const reports = {};
    for (const type of ['following', 'followers']) {
      const { accounts } = lists[type];
      const expected = counts[type], collected = accounts.length;
      if (collected < expected) throw countError(type, collected, expected);
      reports[type] = { expected, collected };
    }
    return { verified: true, settled: true, following: { ...reports.following }, followers: { ...reports.followers } };
  }
  function dispose() {
    current?.observer?.disconnect();
    if (current?.dialog && F4FSelectors.visible(current.dialog)) { try { clickClose(current.dialog); } catch {} }
    for (const dialog of inertDialogs) dialog.inert = false;
    inertDialogs.clear();
    document.documentElement.removeAttribute(VERIFYING);
    current = null;
    for (const type of ['following', 'followers']) delete lists[type];
  }
  return { prepare, open, collect, close, validation, dispose, get lastFailure() { return lastFailure; } };
})();
