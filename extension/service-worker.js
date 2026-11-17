const ACTIVE = new Set(['navigating', 'waiting', 'running']);
const IG_URLS = ['https://www.instagram.com/*', 'https://instagram.com/*'];
const IG_ORIGIN = /^https:\/\/(www\.)?instagram\.com$/;
const USERNAME = /^[a-zA-Z0-9._]{1,30}$/;
const CHECK_LIMIT_MS = 20 * 60 * 1000;
const LIST_TRAFFIC = { urls: IG_URLS.flatMap(site => ['following', 'followers'].map(list =>
  site.replace('*', `api/v1/friendships/*/${list}*`))), types: ['xmlhttprequest'] };
const idle = () => ({ status: 'idle', message: 'Ready when you are.' });
const read = async () => (await chrome.storage.session.get('operation')).operation || idle();
let lastBadge;
const save = async operation => {
  await chrome.storage.session.set({ operation });
  const badge = operation.status === 'running' ? '…' :
    operation.status === 'completed' ? '✓' : operation.status === 'error' ? '!' : '';
  if (badge !== lastBadge) {
    await chrome.action.setBadgeText({ text: badge });
    await chrome.action.setBadgeBackgroundColor({ color: badge === '!' ? '#B42318' : '#833AB4' });
    lastBadge = badge;
  }
  return operation;
};
let queue = Promise.resolve();
function serialized(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
function retryAfter(headers, now) {
  let latest = 0;
  for (const { name, value } of headers || []) {
    if (name.toLowerCase() !== 'retry-after' || !value?.trim()) continue;
    let text = value.trim();
    if (/^\d+$/.test(text)) {
      latest = Math.max(latest, Math.min(now + Number(text) * 1000, 8.64e15));
      continue;
    }
    const rfc850 = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d\d)-(\w{3})-(\d\d) (\d\d:\d\d:\d\d) GMT$/.exec(text);
    const asctime = /^(\w{3}) (\w{3}) ( \d|\d\d) (\d\d:\d\d:\d\d) (\d{4})$/.exec(text);
    if (rfc850) {
      const [, day, date, month, year, time] = rfc850;
      const current = new Date(now).getUTCFullYear();
      let fullYear = current - current % 100 + Number(year);
      if (fullYear > current + 50) fullYear -= 100;
      if (fullYear < current - 50) fullYear += 100;
      text = `${day.slice(0, 3)}, ${date} ${month} ${fullYear} ${time} GMT`;
    } else if (asctime) {
      const [, day, month, date, time, year] = asctime;
      text = `${day}, ${date.replace(' ', '0')} ${month} ${year} ${time} GMT`;
    }
    const time = Date.parse(text);
    if (time > now && new Date(time).toUTCString() === text) latest = Math.max(latest, time);
  }
  return latest > now ? latest : 0;
}
function cooldownMessage(operation) {
  const { rateLimit, retryAt, status } = operation;
  const list = rateLimit.list === 'following' ? 'Following' : 'Followers';
  const message = [`Instagram returned HTTP 429 while loading ${list} at ${new Date(rateLimit.receivedAt).toLocaleString()}.`];
  if (rateLimit.noRetryTime) message.push('Instagram supplied no usable retry time.');
  if (rateLimit.attempt) message.push('The automatic retry also hit a limit.');
  else if (retryAt >= operation.deadline) message.push('The retry time exceeds the time left in this check.');
  if (retryAt > Date.now()) {
    const action = status === 'running' ? 'Next attempt after' : 'Retry after';
    message.push(`${action} ${new Date(retryAt).toLocaleString()}.`);
  } else if (retryAt) message.push('Instagram’s retry time has passed.');
  if (status === 'error' && !(retryAt > Date.now())) message.push('Choose Retry Checking in F4F Checker to try again.');
  return message.join('\n');
}
const listLabel = list => list === 'following' ? 'Following' : 'Followers';
const countDetail = ({ collected, expected }) => collected > expected ?
  `${collected} found. Your profile shows ${expected}.` : `${collected} of ${expected} found.`;
function waitingForList(progress) {
  return Number.isSafeInteger(progress?.expected) ?
    `The wait is over.\n${listLabel(progress.list)} · ${countDetail(progress)}` :
    'The wait is over. Instagram is loading the list.';
}
async function refreshCooldown(operation) {
  if (operation.reason !== 'rate_limited' || !operation.retryAt || operation.retryAt > Date.now()) return operation;
  const running = operation.status === 'running';
  return save({ ...operation, reason: running ? 'waiting_for_instagram' : undefined,
    message: running ? waitingForList(operation.progress) : cooldownMessage(operation) });
}
async function reportRateLimit(operation) {
  const next = { ...operation, reason: 'rate_limited' };
  next.message = cooldownMessage(next);
  const { runId, status, reason, retryAt, retryUsed, rateLimit, message } = next;
  void chrome.tabs.sendMessage(next.tabId, { type: 'F4F_RATE_LIMIT', runId, status, reason,
    retryAt, retryUsed, rateLimit, message }, { frameId: 0, documentId: next.documentId }).catch(() => {});
  await save(next);
  return next;
}
function requestCategory(details) {
  if (details.frameId !== 0 || details.tabId < 0 || !IG_ORIGIN.test(details.initiator || '')) return null;
  const url = new URL(details.url);
  const list = url.pathname.match(/^\/api\/v1\/friendships\/\d+\/(following|followers)\/?$/)?.[1];
  if (!list || !IG_ORIGIN.test(url.origin)) return null;
  return { list, category: url.searchParams.has('query') ? 'search' :
    url.searchParams.has('max_id') ? 'pagination' : 'list' };
}
async function trackListRequest(details, category, now, starting) {
  const { operation, listRequests } = await chrome.storage.session.get(['operation', 'listRequests']);
  if (!operation || operation.tabId !== details.tabId || operation.documentId !== details.documentId ||
    now < operation.scanStartedAt) return;
  const ids = listRequests?.runId === operation.runId ? listRequests.ids : [];
  if (starting) {
    if (operation.status === 'running' && !ids.includes(details.requestId)) {
      await chrome.storage.session.set({ listRequests: { runId: operation.runId, ids: [...ids, details.requestId] } });
    }
    return;
  }
  if (!ids.includes(details.requestId)) return;
  await chrome.storage.session.set({ listRequests: { runId: operation.runId,
    ids: ids.filter(id => id !== details.requestId) } });
  if (details.statusCode !== 429 ||
    (operation.status !== 'running' && !(operation.status === 'error' && operation.rateLimit))) return;

  const attempt = operation.retryUsed ? 1 : 0;
  const previous = operation.rateLimit?.attempt === attempt ? operation.rateLimit : null;
  const serverTime = retryAfter(details.responseHeaders, now);
  const retryAt = Math.max(previous ? operation.retryAt || 0 : 0, serverTime) || undefined;
  const rateLimit = { ...(previous || { ...category, attempt, receivedAt: now }),
    noRetryTime: Boolean(previous?.noRetryTime || !serverTime) };
  const stop = operation.status !== 'running' || rateLimit.noRetryTime || operation.retryUsed ||
    retryAt >= operation.deadline;
  if (previous && previous.noRetryTime === rateLimit.noRetryTime && retryAt === operation.retryAt) return;
  await reportRateLimit({ ...operation, status: stop ? 'error' : 'running', rateLimit, retryAt });
}
async function claimRetry(operation) {
  if (operation.status !== 'running' || !operation.rateLimit || operation.retryUsed ||
    operation.retryAt > Date.now()) return operation;
  if (Date.now() >= operation.deadline) return reportRateLimit({ ...operation, status: 'error' });
  const { listRequests } = await chrome.storage.session.get('listRequests');
  const next = await refreshCooldown(operation);
  // A request still in flight can send a later Retry-After.
  if (listRequests?.runId === operation.runId && listRequests.ids.length) return next;
  return save({ ...next, retryUsed: true });
}
function fromPopup(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
}
function fromPage(sender, operation, message) {
  return sender.frameId === 0 && sender.tab?.id === operation.tabId &&
    (!operation.documentId || sender.documentId === operation.documentId) &&
    message.runId === operation.runId && /^https:\/\/(www\.)?instagram\.com\//.test(sender.url || '');
}
async function fail(operation, message, reason = 'checker_error') {
  if (!ACTIVE.has(operation.status)) return operation;
  if (operation.rateLimit && (operation.retryAt > Date.now() || reason === 'rate_limited')) {
    return reportRateLimit({ ...operation, status: 'error' });
  }
  const error = await save({ ...operation, status: 'error', message, reason, results: undefined });
  if (operation.tabId) chrome.tabs.sendMessage(operation.tabId, {
    type: 'F4F_ERROR', runId: operation.runId, message, reason
  }).catch(() => {});
  return error;
}
async function foreground(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return tab;
}
async function ensureContent(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'F4F_PING' }); }
  catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['verification.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['theme.js', 'localization.js', 'list-controls.js', 'result-copy.js', 'content.js'] });
  }
}
async function assist(operation) {
  const tab = await chrome.tabs.get(operation.tabId);
  if (tab.status !== 'complete') return;
  await ensureContent(operation.tabId);
  await chrome.tabs.sendMessage(operation.tabId, {
    type: 'F4F_ASSIST', runId: operation.runId, username: operation.username || null
  });
}
async function start() {
  const previous = await refreshCooldown(await read());
  if (ACTIVE.has(previous.status)) {
    try {
      if (previous.tabId) await foreground(previous.tabId);
      return previous;
    } catch { return fail(previous, 'The Instagram tab is unavailable. Please retry.', 'interrupted'); }
  }
  if (previous.retryAt > Date.now()) return previous;
  if (previous.status === 'error' && previous.tabId) {
    const probe = await chrome.tabs.sendMessage(previous.tabId, { type: 'F4F_PING' }).catch(() => null);
    if (probe?.running && probe.runId === previous.runId) return previous;
  }
  let operation = await save({ status: 'navigating', message: 'Opening Instagram…',
    runId: crypto.randomUUID(), startedAt: Date.now(), username: null });
  try {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    const instagram = await chrome.tabs.query({ url: IG_URLS });
    const existing = instagram.find(tab => tab.id === current?.id) ||
      instagram.find(tab => tab.windowId === current?.windowId) || instagram[0];
    const tab = existing ? await foreground(existing.id) :
      await chrome.tabs.create({ url: 'https://www.instagram.com/', active: true });
    if (!existing) await chrome.windows.update(tab.windowId, { focused: true });
    operation = await save({ ...operation, tabId: tab.id, status: 'waiting',
      message: 'Opening your profile on Instagram…' });
    await assist(operation);
    return operation;
  } catch (error) { return fail(operation, error.message, 'navigation_error'); }
}
async function runningStatus(operation) {
  try {
    const probe = await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_PING' });
    if (probe?.runId === operation.runId && probe.running) return operation;
  } catch {}
  return fail(operation, 'The Instagram page changed and checking stopped. Please retry.', 'interrupted');
}
async function status() {
  const operation = await refreshCooldown(await read());
  if (!ACTIVE.has(operation.status)) return operation;
  if (!operation.tabId) return fail(operation, 'Navigation was interrupted. Please retry.', 'navigation_error');
  if (operation.status === 'running') return runningStatus(operation);
  try {
    const tab = await chrome.tabs.get(operation.tabId);
    if (tab.status === 'complete') await assist(operation);
    return await read();
  } catch { return fail(operation, 'The Instagram tab is unavailable. Please retry.', 'interrupted'); }
}
async function handle(message, sender) {
  if (fromPopup(sender)) {
    if (message.type === 'F4F_STATUS') return status();
    if (message.type === 'F4F_START') return start();
    if (message.type === 'F4F_CONTINUE') {
      const operation = await read();
      if (operation.status !== 'waiting') return start();
      const next = await save({ ...operation, reason: undefined,
        message: 'Opening your profile on Instagram…' });
      await foreground(next.tabId);
      await ensureContent(next.tabId);
      await chrome.tabs.sendMessage(next.tabId, { type: 'F4F_RESET_WAIT' });
      await assist(next);
      return next;
    }
    if (message.type === 'F4F_VIEW_RESULTS') {
      const operation = await read();
      if (operation.status !== 'completed') throw new Error('No completed results are available.');
      if (!operation.results) throw new Error('Results are no longer available. Start another check.');
      let tab;
      try { tab = await foreground(operation.tabId); } catch {}
      if (!tab || !/^https:\/\/(www\.)?instagram\.com\//.test(tab.url || '')) {
        tab = await chrome.tabs.create({ url: 'https://www.instagram.com/', active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await save({ ...operation, tabId: tab.id, showResultsOnLoad: true });
      } else if (tab.status === 'complete') {
        await ensureContent(tab.id);
        await chrome.tabs.sendMessage(tab.id, { type: 'F4F_SHOW_RESULTS', results: operation.results });
      } else await save({ ...operation, showResultsOnLoad: true });
      return operation;
    }
  }
  const operation = await read();
  if (message.type === 'F4F_PAGE_LOADED' && sender.frameId === 0 && sender.tab?.id === operation.tabId) {
    if (operation.status === 'running' && operation.documentId && operation.documentId !== sender.documentId) {
      return fail(operation, 'The Instagram page changed and checking stopped. Please retry.', 'interrupted');
    }
    if (operation.status === 'waiting') await assist(operation);
    if (operation.status === 'completed' && operation.showResultsOnLoad) {
      await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_SHOW_RESULTS', results: operation.results });
      await save({ ...operation, showResultsOnLoad: false });
    }
    return operation.status === 'error' && operation.rateLimit ? refreshCooldown(operation) : { ok: true };
  }
  if (!fromPage(sender, operation, message)) return { ignored: true };
  if (message.type === 'F4F_COOLDOWN_STATUS') return refreshCooldown(operation);
  if (message.type === 'F4F_RETRY') return claimRetry(operation);
  if (message.type === 'F4F_RESET_SEARCH_FIELD' && operation.status === 'running' && operation.retryUsed &&
    operation.documentId && Date.now() < operation.deadline) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: operation.tabId, documentIds: [operation.documentId] }, world: 'MAIN',
      func: () => {
        const field = document.activeElement;
        if (!field?.matches('[role="dialog"][data-f4f-verifying] input[data-f4f-search-replay]')) return false;
        field.value = '';
        return true;
      }
    });
    return { ok: injection?.result === true };
  }
  if (message.type === 'F4F_WAIT_STATUS' && operation.status === 'waiting') {
    const username = message.reason === 'profile_navigation' &&
      typeof message.username === 'string' && USERNAME.test(message.username) ?
      message.username : operation.username;
    return save({ ...operation, username, reason: message.reason, message: message.message });
  }
  if (message.type === 'F4F_READY' && operation.status === 'waiting') {
    await foreground(operation.tabId);
    const scanStartedAt = Date.now(), deadline = scanStartedAt + CHECK_LIMIT_MS;
    const claim = await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_CLAIM', runId: operation.runId, deadline },
      { frameId: 0, documentId: sender.documentId });
    if (!claim.ok) return fail(operation, 'The profile is no longer ready. Please retry.', 'readiness_error');
    const username = new URL(sender.url).pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/)?.[1];
    const running = await save({ ...operation, username, documentId: sender.documentId, scanStartedAt, deadline,
      status: 'running', reason: undefined,
      message: 'Starting with the accounts you follow.' });
    try {
      const target = sender.documentId ? { tabId: operation.tabId, documentIds: [sender.documentId] } : { tabId: operation.tabId };
      await chrome.scripting.executeScript({ target,
        files: ['collector.js', 'adapter.js', 'safe-runner.js'] });
    } catch (error) { return fail(running, error.message, 'injection_error'); }
    return running;
  }
  if (message.type === 'F4F_PROGRESS' && operation.status === 'running') {
    const { list, collected, expected } = message;
    if (!['following', 'followers'].includes(list) ||
      !Number.isSafeInteger(collected) || collected < 0 ||
      !Number.isSafeInteger(expected) || expected < 0) return { ignored: true };
    const progress = { list, collected, expected };
    const state = await refreshCooldown(operation);
    const last = state.progress;
    if (last?.list === list && last.collected === collected && last.expected === expected) return state;
    if (state.rateLimit && !state.retryUsed) {
      return save({ ...state, progress, message: state.reason === 'waiting_for_instagram' ?
        waitingForList(progress) : state.message });
    }
    if (state.reason === 'waiting_for_instagram' && last?.list === list && collected <= last.collected && collected < expected) {
      return save({ ...state, progress, message: waitingForList(progress) });
    }
    const detail = `${listLabel(list)} · ${countDetail(progress)}`;
    return save({ ...state, progress, reason: undefined, message: detail });
  }
  if (message.type === 'F4F_FINISHED' && operation.status === 'running') {
    if (operation.rateLimit && !operation.retryUsed) return reportRateLimit({ ...operation, status: 'error' });
    const validation = message.validation;
    if (validation?.verified !== true || validation.settled !== true || !['following', 'followers'].every(type =>
      Number.isSafeInteger(validation[type]?.expected) && validation[type].expected >= 0 &&
      Number.isSafeInteger(validation[type]?.collected) && validation[type].collected >= validation[type].expected)) {
      return fail(operation, 'Both lists could not be verified. No comparison was made.', 'incomplete_scan');
    }
    const results = message.results;
    if (!results || typeof results.heading !== 'string' || typeof results.summary !== 'string' ||
      !Array.isArray(results.accounts) || !results.accounts.every(account =>
        typeof account.name === 'string' && typeof account.href === 'string' &&
        account.href.startsWith('/') && !account.href.startsWith('//'))) {
      return fail(operation, 'The checker output could not be read. Please retry.');
    }
    try {
      return await save({ ...operation, status: 'completed', reason: undefined, message: 'Your results are ready on Instagram.',
        finishedAt: Date.now(), results, validation });
    } catch {
      return fail(operation, 'The results exceed session storage capacity. The verified list is still on Instagram.', 'storage_error');
    }
  }
  if (message.type === 'F4F_FAILED') {
    const detail = message.message || 'Checking failed.';
    const stalledAfterWait = operation.reason === 'waiting_for_instagram' && message.reason === 'incomplete_scan';
    return fail(operation, stalledAfterWait ? `Instagram’s list stalled after the cooldown. ${detail}` : detail, message.reason);
  }
  return { ignored: true };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  serialized(() => handle(message, sender)).then(reply, error => reply({ error: error.message }));
  return true;
});
function observeListRequest(starting) {
  return details => {
    const category = requestCategory(details);
    if (!category) return;
    const now = Date.now();
    serialized(() => trackListRequest(details, category, now, starting)).catch(console.error);
  };
}
chrome.webRequest.onBeforeRequest.addListener(observeListRequest(true), LIST_TRAFFIC);
chrome.webRequest.onHeadersReceived.addListener(observeListRequest(false), LIST_TRAFFIC, ['responseHeaders']);
chrome.webRequest.onErrorOccurred.addListener(observeListRequest(false), LIST_TRAFFIC);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  serialized(async () => {
    const operation = await read();
    if (operation.tabId !== tabId) return;
    if (operation.status === 'running') await runningStatus(operation);
    else if (operation.status === 'waiting') {
      try { await assist(operation); } catch (error) { await fail(operation, error.message, 'navigation_error'); }
    }
  }).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => {
  serialized(async () => {
    const operation = await read();
    if (operation.tabId === tabId) await fail(operation, 'The Instagram tab was closed. Please retry.', 'interrupted');
  }).catch(console.error);
});
