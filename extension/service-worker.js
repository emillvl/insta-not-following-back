const ACTIVE = new Set(['navigating', 'waiting', 'running']);
const IG_URLS = ['https://www.instagram.com/*', 'https://instagram.com/*'];
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
    type: 'F4F_ERROR', runId: operation.runId, message
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['localization.js', 'content.js'] });
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
      try { tab = await foreground(operation.tabId); } catch { /* Tab was closed. */ }
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
      typeof message.username === 'string' && /^[a-zA-Z0-9._]{1,30}$/.test(message.username) ?
      message.username : operation.username;
    return save({ ...operation, username, reason: message.reason, message: message.message });
  }
  if (message.type === 'F4F_READY' && operation.status === 'waiting') {
    await foreground(operation.tabId);
    const claim = await chrome.tabs.sendMessage(operation.tabId, { type: 'F4F_CLAIM', runId: operation.runId });
    if (!claim.ok) return fail(operation, 'The profile is no longer ready. Please retry.', 'readiness_error');
    const running = await save({ ...operation, status: 'running', reason: undefined,
      message: 'Checking following, then followers…' });
    try {
      await chrome.scripting.executeScript({ target: { tabId: operation.tabId },
        files: ['adapter.js', 'checker-runner.js'] });
    } catch (error) { return fail(running, error.message, 'injection_error'); }
    return running;
  }
  if (message.type === 'F4F_FINISHED' && operation.status === 'running') {
    const results = message.results;
    if (!results || typeof results.heading !== 'string' || typeof results.summary !== 'string' ||
      !Array.isArray(results.accounts) || !results.accounts.every(account =>
        typeof account.name === 'string' && typeof account.href === 'string' &&
        account.href.startsWith('/') && !account.href.startsWith('//'))) {
      return fail(operation, 'The checker output could not be read. Please retry.');
    }
    try {
      return await save({ ...operation, status: 'completed', message: 'Checking Complete',
        finishedAt: Date.now(), results });
    } catch {
      return fail(operation, 'The results exceed session storage capacity. The original list is still on Instagram.');
    }
  }
  if (message.type === 'F4F_FAILED') return fail(operation, message.message || 'Checking failed.', message.reason);
  return { ignored: true };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  serialized(() => handle(message, sender)).then(reply, error => reply({ error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  serialized(async () => {
    const operation = await read();
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
    if (operation.tabId === tabId) await fail(operation, 'The Instagram tab was closed. Please retry.', 'interrupted');
  }).catch(console.error);
});
