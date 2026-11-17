
globalThis.F4FCollector = (() => {
  const ROWS = 'a[href]';
  const DIALOG = '[role="dialog"]';
  const HIDDEN = '[hidden], [aria-hidden="true"]';
  const OPEN_MS = 3000, SETUP_MS = 2000, STEP_MS = 1500, CLOSE_MS = 2000;
  const STABLE_PASSES = 7, SHORT_STABLE_PASSES = 8;
  const SCROLL_STALL_MS = 3 * STEP_MS;
  const SCROLL_GAP_MS = SHORT_STABLE_PASSES * STEP_MS;
  const LOAD_STALL_MS = 90000;
  const MAX_DIALOG_RECOVERIES = 4;
  const DIALOG_RECOVERY_MS = 3000;
  const MAX_EXACT_SEARCHES = 4;
  const VERIFYING = 'data-f4f-verifying';
  const REPLAY_INPUT = 'data-f4f-search-replay';
  const SEARCH_FIELDS = 'input[type="search"], input[type="text"], input:not([type])';
  const STATUS_CONTROLS = 'button, [role="button"], [role="status"]';
  const INACTIVE_LABELS = new Set(['deactivated account', 'deactivated']);
  const FOLLOWS_YOU = new Map([['follows you', true], ['seni takip ediyor', true]]);
  const RELATIONSHIPS = {
    following: new Map([
      ['following', true], ['takiptesin', true], ['takip ediliyor', true],
      ['follow', false], ['follow back', false], ['requested', false],
      ['takip et', false], ['geri takip et', false], ['istek gönderildi', false]
    ]),
    followers: new Map([...FOLLOWS_YOU, ['remove', true], ['kaldır', true]])
  };
  let username, active, counts, deadline, current, lastFailure, lastProgress, searchesLeft, verificationObserver;
  const lists = {};
  const concealedDialogs = new Set();
  function failure(message, reason = 'incomplete_scan') {
    lastFailure = new Error(message);
    lastFailure.reason = reason;
    return lastFailure;
  }
  function check() {
    const rate = F4FBridge.rateStatus;
    if (rate?.status === 'error' || (Date.now() >= deadline && rate && !rate.retryUsed)) {
      throw failure(rate.message, 'rate_limited');
    }
    const route = current && F4FSelectors.listFromHref(location.href);
    if (!active?.() || (F4FSelectors.usernameFromHref(location.href) !== username &&
      !(route?.username === username && route?.type === current?.type))) {
      throw failure('Checking was interrupted. Return to your profile and retry.', 'interrupted');
    }
    if (current && Date.now() >= deadline) {
      throw failure(`The ${current.type} scan reached its time limit (${current.users.size} of ${current.expected} collected). Retry checking.`);
    }
  }
  function progress(force = false) {
    if (current.reported === current.users.size || (!force && Date.now() - lastProgress < 1000)) return;
    lastProgress = Date.now();
    current.reported = current.users.size;
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
    if (current.area && current.dialog.contains(current.area)) return current.area;
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
    else for (const anchor of node.querySelectorAll(ROWS)) row(anchor);
  }
  function markEvidence(node, subtree = false) {
    if (!current.evidenceControls || node?.nodeType !== 1) return;
    const control = node.closest(STATUS_CONTROLS);
    if (control) current.evidenceControls.add(control);
    for (const related of current.rowControls.get(node) || []) current.evidenceControls.add(related);
    if (subtree && node.childElementCount) {
      for (const child of node.querySelectorAll(STATUS_CONTROLS)) current.evidenceControls.add(child);
    }
  }
  function mutations(records) {
    if (current.area && !current.dialog.contains(current.area)) {
      bindArea(scrollArea(current.dialog));
      capture(captureScope());
    }
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
        if (record.attributeName === 'hidden' || record.attributeName === 'aria-hidden') {
          capture(element);
          markEvidence(element, true);
        }
      }
      capture(anchor);
      markEvidence(anchor);
      if (element !== anchor) markEvidence(element);
      if (record.type === 'childList') {
        for (const node of record.addedNodes) { capture(node); markEvidence(node, true); }
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
    if (F4FBridge.wait) await F4FBridge.wait(ms);
    else await new Promise(resolve => setTimeout(resolve, ms));
    check();
  }
  function paused() {
    return F4FBridge.rateStatus && !F4FBridge.rateStatus.retryUsed;
  }
  async function waitForInstagram() {
    check();
    if (!paused()) return false;
    while (paused()) {
      const remaining = F4FBridge.rateStatus.retryAt - Date.now();
      if (remaining > 0) await wait(Math.min(STEP_MS, remaining));
      else {
        await F4FBridge.claimRetry();
        check();
        if (paused()) await wait(STEP_MS);
      }
    }
    return true;
  }
  async function until(predicate, timeout, message) {
    const end = Date.now() + timeout;
    while (!predicate()) {
      check();
      if (Date.now() >= end) throw failure(message, 'page_readiness');
      await wait(100);
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
    current.evidenceControls?.clear();
    markEvidence(captureScope(), true);
  }
  function observeDialog(dialog) {
    const scan = current;
    scan.observer?.disconnect();
    scan.dialog = dialog;
    bindArea(scrollArea(dialog));
    capture(captureScope());
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
      await wait(100);
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
  function relationshipStates(scope, labels, controls = scope.querySelectorAll(STATUS_CONTROLS), rowControls) {
    const states = new Map();
    for (const control of controls) {
      if (!scope.contains(control)) continue;
      const values = [control.childElementCount ? control.innerText : control.textContent,
        control.getAttribute('aria-label'), control.getAttribute('title')]
        .map(text => text?.trim().toLowerCase().replace(/\u0307/g, ''));
      const inactive = values.some(text => INACTIVE_LABELS.has(text));
      const positive = values.some(text => labels.get(text) === true);
      const negative = values.some(text => labels.get(text) === false);
      const state = inactive ? 'inactive' : positive && negative ? null : positive ? true : negative ? false : undefined;
      if (state === undefined || control.closest('header, nav, [role="tab"]') || !F4FSelectors.visible(control)) continue;
      for (let row = control.parentElement; row && row !== scope; row = row.parentElement) {
        if (row.querySelector(SEARCH_FIELDS)) break;
        const links = [...row.querySelectorAll(ROWS)].map(anchor => [anchor, accountName(anchor)]).filter(([, name]) => name);
        const names = new Set(links.map(([, name]) => name));
        if (names.size === 1) {
          recordState(states, names.values().next().value, state);
          if (rowControls) {
            for (const [anchor] of links) {
              if (!rowControls.has(anchor)) rowControls.set(anchor, new Set());
              rowControls.get(anchor).add(control);
            }
          }
        }
        if (names.size) break;
      }
    }
    return states;
  }
  function rememberEvidence() {
    if (!current.evidenceControls?.size) return;
    const scope = captureScope();
    const labels = current.type === 'following' ? FOLLOWS_YOU : RELATIONSHIPS.following;
    if (scope) {
      for (const [name, state] of relationshipStates(scope, labels, current.evidenceControls, current.rowControls)) {
        recordState(current.evidence, name, state);
      }
    }
    current.evidenceControls.clear();
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
    deadline = F4FBridge.deadline ?? Date.now() + 20 * 60 * 1000;
    searchesLeft = MAX_EXACT_SEARCHES;
    lastProgress = 0;
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
      recoveries: 0 };
    if (type === 'following' || lists.following.accounts.length < counts.following) {
      current.evidenceControls = new Set();
      current.rowControls = new WeakMap();
    }
    progress(true);
    if (current.expected > 0) await openDialog();
    else await waitForInstagram();
  }
  function clickListControl(control) {
    const link = control.closest('a[href]');
    const cancelDefault = event => { if (event.composedPath().includes(link)) event.preventDefault(); };
    if (link && F4FSelectors.listFromHref(link.href)) window.addEventListener('click', cancelDefault);
    try { control.click(); } finally { window.removeEventListener('click', cancelDefault); }
  }
  async function openDialog(observe = true) {
    const { type } = current;
    let openingDeadline = 0;
    while (true) {
      const retry = await waitForInstagram() && F4FBridge.rateStatus.rateLimit.list === type;
      let dialog = listView();
      if (retry && openingDeadline && dialog) {
        if (observe && dialog === current.dialog && validateSize() && !loading(current.area)) return;
        current.dialog = dialog;
        await closeDialog();
        dialog = null;
      }
      if (!dialog && (!openingDeadline || retry)) {
        const control = F4FListControls.find(document, username, type);
        if (!control) throw failure(`Instagram’s ${type} control is unavailable. Reload your profile and retry.`, 'page_readiness');
        openingDeadline = Date.now() + 15000;
        clickListControl(control);
        dialog = listView();
      }
      if (dialog) {
        if (observe) observeDialog(dialog);
        else {
          current.dialog = dialog;
          concealDialog(dialog);
        }
        await wait(OPEN_MS);
        await wait(SETUP_MS);
        if (!paused()) return;
        continue;
      }
      if (Date.now() >= openingDeadline) throw failure(`Instagram’s ${type} dialog did not open. Retry checking.`, 'page_readiness');
      await wait(100);
    }
  }
  async function collect() {
    check();
    if (current.expected === 0) return finishList();
    let previousHeight = 0, previousSize = 0, noNewUsers = 0, stableLoops = 0;
    let stalledAt = null, blockedAt = null, quietEndAt = null, rechecked = false;
    let retrySize = null, replayEnd = false;
    while (true) {
      if (await waitForInstagram() && F4FBridge.rateStatus.rateLimit.list === current.type) {
        retrySize = current.users.size;
        replayEnd = true;
        stalledAt = null; blockedAt = null; noNewUsers = 0; stableLoops = 0;
      }
      if (!F4FSelectors.visible(current.dialog)) {
        await ensureDialog();
        // Check for a 429 again after the dialog returns.
        stableLoops = 0; noNewUsers = 0;
        continue;
      }
      if (!current.dialog.contains(current.area) || !current.area.contains(current.lastRow) ||
        current.area.scrollHeight <= current.area.clientHeight) {
        const area = scrollArea(current.dialog);
        if (area !== current.area) { bindArea(area); stableLoops = 0; blockedAt = null; }
        capture(captureScope());
      }
      flush();
      rememberEvidence();
      progress();
      const area = current.area;
      const height = area?.scrollHeight || 0;
      const bottom = area ? height - area.clientHeight : 0;
      const top = area?.scrollTop || 0;
      const atEnd = area ? top >= bottom - 2 : !current.hasViewport;
      const pending = loading(area);
      const complete = validateSize();
      if (current.users.size > previousSize) {
        stalledAt = null; rechecked = false;
        current.recoveries = 0; noNewUsers = 0; stableLoops = 0;
      }
      if (height !== previousHeight) stableLoops = 0;
      if (stableLoops >= STABLE_PASSES && atEnd && !pending && complete) break;

      const now = Date.now();
      let moved = false;
      if (replayEnd && !pending) {
        replayEnd = false;
        if (!complete && current.users.size === retrySize && atEnd && top > 2) {
          area.scrollTop = 0;
          await wait(STEP_MS);
          continue;
        }
      }
      if (area && top < bottom && !pending) {
        if (!atEnd) moved = step(now - (blockedAt ?? now));
        else if (!complete) { area.scrollTop = bottom; moved = true; }
        blockedAt = moved ? null : blockedAt ?? now;
      } else blockedAt = null;

      if (moved || stableLoops < SHORT_STABLE_PASSES) {
        stalledAt = null;
        quietEndAt = null;
      } else {
        stalledAt ??= now;
        const stalledFor = now - stalledAt;
        const settled = atEnd && !pending;
        if (settled && retrySize === current.users.size && !complete) {
          throw countError(current.type, current.users.size, current.expected);
        }
        if (settled && !rechecked && top > 2 && !complete) {
          rechecked = true;
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
        noNewUsers = 0; stalledAt = null; rechecked = false;
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
    const list = { accounts, evidence: current.evidence };
    if (accounts.length < current.expected) list.searchable = Boolean(current.dialog && searchField(current.dialog));
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
    await waitForInstagram();
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
      const dialog = verificationObserver ? verificationView() :
        F4FSelectors.visible(current.dialog) ? current.dialog : listView();
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
    if (concealedDialogs.has(dialog)) return;
    dialog.setAttribute(VERIFYING, '');
    concealedDialogs.add(dialog);
  }
  function verificationView() {
    let dialog = current.dialog;
    if (!dialog || !F4FSelectors.visible(dialog)) {
      dialog = listView();
      if (!dialog || (!listTitle(dialog, current.type) && !searchField(dialog))) return null;
    }
    current.dialog = dialog;
    concealDialog(dialog);
    return dialog;
  }
  function startVerification() {
    verificationView();
    verificationObserver = new MutationObserver(() => {
      if (!current.dialog || !F4FSelectors.visible(current.dialog)) verificationView();
    });
    verificationObserver.observe(document.body, { childList: true, subtree: true });
  }
  function stopVerification() {
    verificationObserver?.disconnect();
    verificationObserver = null;
    for (const dialog of concealedDialogs) dialog.removeAttribute(VERIFYING);
    concealedDialogs.clear();
  }
  function searchField(dialog) {
    const fields = [...dialog.querySelectorAll(SEARCH_FIELDS)]
      .filter(input => !input.disabled && !input.readOnly && F4FSelectors.visible(input));
    const search = fields.filter(input => input.type === 'search' || input.getAttribute('role') === 'searchbox' ||
      ['search', 'ara'].includes((input.getAttribute('aria-label') || input.placeholder).trim().toLowerCase()));
    if (search.length === 1) return search[0];
    return fields.length === 1 ? fields[0] : null;
  }
  async function focusSearchField() {
    const end = Date.now() + DIALOG_RECOVERY_MS;
    while (true) {
      await waitForInstagram();
      const dialog = verificationView();
      const field = dialog && searchField(dialog);
      if (field) {
        field.focus({ preventScroll: true });
        if (document.activeElement === field) return field;
      }
      if (Date.now() >= end) return null;
      await wait(100);
    }
  }
  async function resetSearchField(field) {
    // Reset the value in Instagram's page so its input tracker sees the change.
    field.setAttribute(REPLAY_INPUT, '');
    try { return await F4FBridge.resetSearchField(); }
    finally { field.removeAttribute(REPLAY_INPUT); }
  }
  async function searchExact(input, name, requiredSearches) {
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const typeName = field => {
      searchesLeft--;
      value.set.call(field, name);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true,
        inputType: 'insertReplacementText', data: name }));
    };
    typeName(input);
    let quietPasses = 0, busySince = null;
    while (quietPasses < 4) {
      await wait(STEP_MS);
      const retry = await waitForInstagram();
      if (retry && F4FBridge.rateStatus.rateLimit.list === current.type) {
        if (searchesLeft < requiredSearches) return null;
        const field = await focusSearchField();
        if (!field) return null;
        if (field.value === name && !await resetSearchField(field)) return null;
        check();
        if (document.activeElement !== field) return null;
        typeName(field);
        quietPasses = 0; busySince = null;
        continue;
      }
      const dialog = verificationView();
      if (!dialog) { quietPasses++; continue; }
      const area = scrollArea(dialog);
      if (loading(area)) {
        busySince ??= Date.now();
        if (Date.now() - busySince >= LOAD_STALL_MS) return null;
        continue;
      }
      busySince = null;
      quietPasses++;
      if (searchField(dialog)?.value.toLowerCase() !== name) continue;
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
    return list.searchable && candidates.length >= missing ? candidates : null;
  }
  async function verifyCandidates(candidates, reservedSearches = 0) {
    current.observer?.disconnect();
    const list = lists[current.type];
    for (const [index, name] of candidates.entries()) {
      const missing = current.expected - list.accounts.length;
      if (!missing || candidates.length - index < missing || searchesLeft < missing + reservedSearches) break;
      const input = await focusSearchField();
      if (!input) break;
      const confirmed = await searchExact(input, name, missing + reservedSearches);
      if (confirmed === null) break;
      if (!confirmed) continue;
      list.accounts.push(name);
      current.users.add(name);
      progress(true);
    }
  }
  async function reconcileLists() {
    const following = verificationCandidates('following');
    const followers = verificationCandidates('followers');
    const missingFollowing = Math.max(0, counts.following - lists.following.accounts.length);
    const missingFollowers = Math.max(0, counts.followers - lists.followers.accounts.length);
    const canVerify = following && followers && missingFollowing + missingFollowers <= searchesLeft;
    if (current.users.size < lists.followers.accounts.length) {
      current.users = new Set(lists.followers.accounts);
      progress(true);
    }
    if (canVerify && followers.length) {
      startVerification();
      await verifyCandidates(followers, missingFollowing);
    }
    await closeDialog();
    stopVerification();
    current = null;
    if (!canVerify || !missingFollowing || missingFollowing > searchesLeft ||
      lists.followers.accounts.length < counts.followers) return;

    verifyProfileTotals();
    await wait(CLOSE_MS);
    current = { type: 'following', expected: counts.following, users: new Set(lists.following.accounts) };
    startVerification();
    try {
      await openDialog(false);
      await verifyCandidates(following);
    } catch (error) {
      if (error.reason !== 'page_readiness') throw error;
    }
    await closeDialog();
    stopVerification();
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
    if (current?.dialog) {
      const dialog = verificationObserver ? verificationView() :
        F4FSelectors.visible(current.dialog) ? current.dialog : listView();
      if (dialog) { try { clickClose(dialog); } catch {} }
    }
    stopVerification();
    current = null;
    for (const type of ['following', 'followers']) delete lists[type];
  }
  return { prepare, open, collect, close, validation, dispose, get lastFailure() { return lastFailure; } };
})();
