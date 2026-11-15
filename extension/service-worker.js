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
async function pauseForRateLimit(tabId, headers, now) {
  const operation = await read();
  if (operation.status !== 'running' || tabId !== operation.tabId || operation.startedAt > now) return;
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
  void chrome.tabs.sendMessage(tabId, { type: 'F4F_RATE_LIMIT', runId: operation.runId,
    retryAt, message }, { frameId: 0 }).catch(() => {});
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['theme.js', 'localization.js', 'list-controls.js', 'content.js'] });
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
    if (previous.tabId) await foreground(previous.tabId);
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
async function runningStatus(operation) {
  try {
    const probe = await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_PING' });
    if (probe?.runId === operation.runId && probe.running) return operation;
  } catch {}
  return fail(operation, 'The Instagram page changed and checking stopped. Please retry.', 'interrupted');
}
async function status() {
  const operation = await read();
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
  if (message.type === 'F4F_PAGE_LOADED' && sender.frameId === 0 && sender.tab?.id === operation.tabId) {
    if (operation.status === 'waiting') await assist(operation);
    if (operation.status === 'completed' && operation.showResultsOnLoad) {
      await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_SHOW_RESULTS', results: operation.results });
      await save({ ...operation, showResultsOnLoad: false });
    }
    return { ok: true };
  }
  if (!fromPage(sender, operation, message)) return { ignored: true };
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
    const detail = `Checking ${label}… ${count}`;
    if (!operation.reason && operation.message === detail) return operation;
    return save({ ...operation, progress, reason: undefined, message: detail });
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
  if (details.statusCode !== 429 || details.frameId !== 0 || details.tabId < 0 ||
    !IG_ORIGIN.test(details.initiator || '')) return;
  const now = Date.now();
  serialized(() => pauseForRateLimit(details.tabId, details.responseHeaders, now)).catch(console.error);
}, { urls: IG_URLS, types: ['xmlhttprequest'] }, ['responseHeaders']);
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
