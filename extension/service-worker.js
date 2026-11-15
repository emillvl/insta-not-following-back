const ACTIVE = new Set(['navigating', 'waiting', 'running']);
const IG_URLS = ['https://www.instagram.com/*', 'https://instagram.com/*'];
const IG_ORIGIN = /^https:\/\/(www\.)?instagram\.com$/;
const USERNAME = /^[a-zA-Z0-9._]{1,30}$/;
const DEFAULT_LIMIT_WAIT_MS = 60000;
const MAX_LIMIT_WAIT_MS = 4 * DEFAULT_LIMIT_WAIT_MS;
const idle = () => ({ status: 'idle', message: 'Ready when you are.' });
const read = async () => (await chrome.storage.session.get('operation')).operation || idle();
const save = async operation => {
  await chrome.storage.session.set({ operation });
  await chrome.action.setBadgeText({ text: operation.status === 'running' ? '…' :
    operation.status === 'completed' ? '✓' : operation.status === 'error' ? '!' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: operation.status === 'error' ? '#B42318' : '#833AB4' });
  return operation;
};
let queue = Promise.resolve();
function serialized(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
function retryAfter(headers, now) {
  const value = headers?.find(header => header.name.toLowerCase() === 'retry-after')?.value?.trim();
  if (!value) return 0;
  return /^\d+$/.test(value) ? Math.min(now + Number(value) * 1000, 8.64e15) : Date.parse(value);
}
async function pauseForRateLimit(tabId, headers, now, navigation) {
  const operation = await read();
  const onListPage = tabId === operation.listPage?.tabId;
  if (operation.status !== 'running' || (!onListPage && tabId !== operation.tabId) || operation.startedAt > now) return;
  if (navigation && (!onListPage || !expectedListPage(navigation, operation.listPage))) return;
  const currentRetry = operation.retryAt || 0;
  const advertised = retryAfter(headers, now);
  let backoff = operation.rateLimitBackoff || 0;
  let retryAt = advertised;
  if (!(advertised > now)) {
    if (currentRetry > now) return;
    backoff = backoff ? Math.min(2 * backoff, MAX_LIMIT_WAIT_MS) : DEFAULT_LIMIT_WAIT_MS;
    retryAt = now + backoff;
  }
  if (retryAt <= currentRetry) return;
  const message = `Instagram is limiting requests. Next attempt after ${new Date(retryAt).toLocaleString()}.`;
  const signal = { type: 'F4F_RATE_LIMIT', runId: operation.runId, retryAt, message };
  void chrome.tabs.sendMessage(operation.tabId, signal, { frameId: 0 }).catch(() => {});
  if (operation.listPage) void chrome.tabs.sendMessage(operation.listPage.tabId, signal, { frameId: 0 }).catch(() => {});
  await save({ ...operation, retryAt, rateLimitBackoff: backoff, reason: 'rate_limited', message });
}
function fromPopup(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
}
function fromPage(sender, operation, message) {
  return sender.frameId === 0 && sender.tab?.id === operation.tabId &&
    message.runId === operation.runId && /^https:\/\/(www\.)?instagram\.com\//.test(sender.url || '');
}
async function fail(operation, message, reason = 'checker_error') {
  if (!ACTIVE.has(operation.status)) return operation;
  const error = await save({ ...operation, status: 'error', message, reason, results: undefined, listPage: undefined });
  if (operation.listPage) void chrome.tabs.remove(operation.listPage.tabId).catch(() => {});
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['theme.js', 'localization.js', 'list-controls.js', 'content.js'] });
  }
}
function expectedListPage(url, request) {
  try {
    const page = new URL(url);
    const path = page.pathname.replace(/\/$/, '');
    return page.origin === request.origin && [`/${request.username}`, `/${request.username}/${request.list}`].includes(path);
  } catch { return false; }
}
async function finishListPage(operation, result, tabClosed = false) {
  const { listPage, ...rest } = operation;
  await save(rest);
  void chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_LIST_PAGE_RESULT', runId: operation.runId,
    accounts: result.accounts, reason: result.reason, message: result.message }, { frameId: 0 }).catch(() => {});
  if (!tabClosed) void chrome.tabs.remove(listPage.tabId).catch(() => {});
}
async function assistListPage(operation) {
  const request = operation.listPage;
  if (request.started) return;
  try {
    const tab = await chrome.tabs.get(request.tabId);
    if (tab.status !== 'complete') return;
    if (!expectedListPage(tab.url, request)) {
      await finishListPage(operation, {});
      return;
    }
    await ensureContent(tab.id);
    await save({ ...operation, listPage: { ...request, started: true } });
    const target = { tabId: tab.id };
    await chrome.scripting.executeScript({ target, files: ['collector.js'] });
    await chrome.scripting.executeScript({ target, func: options => { void F4FBridge.readListPage(options); },
      args: [{ ...request, runId: operation.runId, retryAt: operation.retryAt, message: operation.message }] });
  } catch {
    await finishListPage(operation, {});
  }
}
async function openListPage(operation, message, sender) {
  const { list, expected, collected, deadline } = message;
  const username = operation.username;
  if (operation.listPage || !USERNAME.test(username || '') || !['following', 'followers'].includes(list) ||
    !Number.isSafeInteger(expected) || !Number.isSafeInteger(collected) || collected < 0 || collected >= expected ||
    !Number.isSafeInteger(deadline) || deadline <= Date.now()) return { ignored: true };
  const { origin } = new URL(sender.url);
  const request = { origin, username, list, expected, deadline };
  if (!expectedListPage(sender.url, request)) return { ignored: true };
  if (operation.retryAt > Date.now()) {
    return { reason: 'rate_limited', message: `Instagram is limiting requests. Retry after ${new Date(operation.retryAt).toLocaleString()}.` };
  }
  const parent = await chrome.tabs.get(operation.tabId);
  const tab = await chrome.tabs.create({ url: `${origin}/${username}/${list}/`, windowId: parent.windowId,
    openerTabId: parent.id, active: true });
  try {
    const listPage = { ...request, tabId: tab.id };
    const next = await save({ ...operation, listPage,
      message: `Found ${collected} of ${expected}. Checking Instagram’s /${list}/ page for the remaining accounts.` });
    if (tab.status === 'complete') await assistListPage(next);
    return { ok: true };
  } catch (error) {
    void chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
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
  const previous = await read();
  if (ACTIVE.has(previous.status)) {
    if (previous.tabId) await foreground(previous.listPage?.tabId || previous.tabId);
    return previous;
  }
  if (previous.retryAt > Date.now()) {
    return save({ ...previous, message: `Instagram is limiting requests. Retry after ${new Date(previous.retryAt).toLocaleString()}.` });
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
      message: 'Opening Instagram’s Profile section…' });
    await assist(operation);
    return operation;
  } catch (error) { return fail(operation, error.message, 'navigation_error'); }
}
async function status() {
  const operation = await read();
  if (!ACTIVE.has(operation.status)) return operation;
  if (!operation.tabId) return fail(operation, 'Navigation was interrupted. Please retry.', 'navigation_error');
  try {
    const tab = await chrome.tabs.get(operation.tabId);
    if (operation.status === 'running') {
      const probe = await chrome.tabs.sendMessage(tab.id, { type: 'F4F_PING' });
      if (probe.runId !== operation.runId || !probe.running) {
        return fail(operation, 'The Instagram page changed and checking stopped. Please retry.', 'interrupted');
      }
      if (operation.listPage && !operation.listPage.started) await assistListPage(operation);
    } else if (tab.status === 'complete') await assist(operation);
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
        message: 'Opening Instagram’s Profile section…' });
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
  const request = operation.listPage;
  const fromListPage = request && sender.frameId === 0 && sender.tab?.id === request.tabId &&
    expectedListPage(sender.url, request);
  if (message.type === 'F4F_PAGE_LOADED') {
    if (fromListPage) await assistListPage(operation);
    else if (sender.frameId !== 0 || sender.tab?.id !== operation.tabId) return { ignored: true };
    else if (operation.status === 'waiting') await assist(operation);
    else if (operation.status === 'completed' && operation.showResultsOnLoad) {
      await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_SHOW_RESULTS', results: operation.results });
      await save({ ...operation, showResultsOnLoad: false });
    }
    return { ok: true };
  }
  if (fromListPage) {
    if (!request.started || operation.status !== 'running' || message.runId !== operation.runId) return { ignored: true };
    if (message.type === 'F4F_LIST_PAGE_DONE') {
      const accounts = Array.isArray(message.accounts) && message.accounts.every(name =>
        typeof name === 'string' && USERNAME.test(name)) ? message.accounts : undefined;
      await finishListPage(operation, { accounts, reason: message.reason, message: message.message });
      return { ok: true };
    }
    if (message.type !== 'F4F_PROGRESS' || message.list !== request.list || message.expected !== request.expected) {
      return { ignored: true };
    }
  } else if (!fromPage(sender, operation, message)) return { ignored: true };
  if (message.type === 'F4F_WAIT_STATUS' && operation.status === 'waiting') {
    const username = message.reason === 'profile_navigation' &&
      typeof message.username === 'string' && USERNAME.test(message.username) ?
      message.username : operation.username;
    return save({ ...operation, username, reason: message.reason, message: message.message });
  }
  if (message.type === 'F4F_READY' && operation.status === 'waiting') {
    await foreground(operation.tabId);
    const claim = await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_CLAIM', runId: operation.runId });
    if (!claim.ok) return fail(operation, 'The profile is no longer ready. Please retry.', 'readiness_error');
    const username = new URL(sender.url).pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/)?.[1];
    const running = await save({ ...operation, username, status: 'running', reason: undefined,
      message: 'Checking following, then followers…' });
    try {
      await chrome.scripting.executeScript({ target: { tabId: operation.tabId },
        files: ['collector.js', 'adapter.js', 'safe-runner.js'] });
    } catch (error) { return fail(running, error.message, 'injection_error'); }
    return running;
  }
  if (message.type === 'F4F_OPEN_LIST_PAGE' && operation.status === 'running') return openListPage(operation, message, sender);
  if (message.type === 'F4F_PROGRESS' && operation.status === 'running') {
    const { list, collected, expected } = message;
    if (!['following', 'followers'].includes(list) ||
      !Number.isSafeInteger(collected) || collected < 0 ||
      !Number.isSafeInteger(expected) || expected < 0) return { ignored: true };
    if (operation.retryAt > Date.now()) return operation;
    const label = list === 'following' ? 'accounts you follow' : 'followers';
    const count = collected > expected ? `${collected} found. Your profile shows ${expected}.` :
      `${collected} of ${expected} found.`;
    const progress = { list, collected };
    const last = operation.progress;
    const baseline = last?.list === list ? last.collected : 0;
    const firstAfterCooldown = operation.reason === 'rate_limited';
    if (collected < expected && (firstAfterCooldown ||
      (operation.reason === 'waiting_for_instagram' && collected <= baseline))) {
      const detail = `Waiting for Instagram to load ${label}. ${count}`;
      if (operation.reason === 'waiting_for_instagram' && operation.message === detail) return operation;
      return save({ ...operation, progress: firstAfterCooldown || last?.list !== list ? progress : last,
        reason: 'waiting_for_instagram', message: detail });
    }
    const checked = fromListPage ? `Checking Instagram’s /${list}/ page` : `Checking ${label}`;
    return save({ ...operation, progress, reason: undefined, message: `${checked}… ${count}` });
  }
  if (message.type === 'F4F_FINISHED' && operation.status === 'running') {
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
      return await save({ ...operation, status: 'completed', reason: undefined, message: 'Checking Complete',
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
chrome.webRequest.onHeadersReceived.addListener(details => {
  const navigation = details.type === 'main_frame' ? details.url : null;
  if (details.statusCode !== 429 || details.frameId !== 0 || details.tabId < 0 ||
    (!navigation && !IG_ORIGIN.test(details.initiator || ''))) return;
  const now = Date.now();
  serialized(() => pauseForRateLimit(details.tabId, details.responseHeaders, now, navigation)).catch(console.error);
}, { urls: IG_URLS, types: ['xmlhttprequest', 'main_frame'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  serialized(async () => {
    const operation = await read();
    if (operation.listPage?.tabId === tabId) {
      if (change.status === 'complete') await assistListPage(operation);
      else if (operation.listPage.started && change.status === 'loading') await finishListPage(operation, {});
      return;
    }
    if (operation.tabId !== tabId) return;
    if (operation.status === 'running' && change.status === 'loading') {
      await fail(operation, 'Instagram was reloaded or navigated away. Checking stopped.', 'interrupted');
    } else if (operation.status === 'waiting' && change.status === 'complete') {
      try { await assist(operation); } catch (error) { await fail(operation, error.message, 'navigation_error'); }
    }
  }).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => {
  serialized(async () => {
    const operation = await read();
    if (operation.listPage?.tabId === tabId) await finishListPage(operation, {}, true);
    if (operation.tabId === tabId) await fail(operation, 'The Instagram tab was closed. Please retry.', 'interrupted');
  }).catch(console.error);
});
