import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const workerSource = readFileSync('extension/service-worker.js', 'utf8');
const verified = { verified: true, settled: true, following: { expected: 2, collected: 2 }, followers: { expected: 1, collected: 1 } };
function harness(initialTabs = [], initialOperation) {
  let operation = initialOperation;
  let listRequests;
  let nextId = 100;
  const tabs = new Map(initialTabs.map(tab => [tab.id, { status: 'complete', windowId: 1, ...tab }]));
  const calls = [];
  let handler, updated, removed, headersReceived, beforeRequest, requestError;
  let now = Date.now();
  if (operation?.status === 'running') {
    operation = { documentId: `document-${operation.tabId}`, scanStartedAt: now - 1,
      deadline: now + 1200000, ...operation };
  }
  let probe = { runId: initialOperation?.runId, running: true };
  const chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener: fn => { handler = fn; } } },
    storage: { session: {
      get: async () => ({ operation, listRequests }),
      set: async data => {
        if (data.operation) operation = structuredClone(data.operation);
        if (data.listRequests) listRequests = structuredClone(data.listRequests);
      }
    } },
    action: { setBadgeText: async args => calls.push(['badge', args.text]), setBadgeBackgroundColor: async () => {} },
    webRequest: {
      onBeforeRequest: { addListener: fn => { beforeRequest = fn; } },
      onHeadersReceived: { addListener: fn => { headersReceived = fn; } },
      onErrorOccurred: { addListener: fn => { requestError = fn; } }
    },
    windows: { update: async (id, args) => { calls.push(['focus', id, args]); } },
    scripting: { executeScript: async args => { calls.push(['inject', args]); },
      insertCSS: async args => { calls.push(['style', args]); } },
    tabs: {
      query: async query => [...tabs.values()].filter(tab => query.url ?
        /^https:\/\/(www\.)?instagram\.com\//.test(tab.url) : tab.active),
      create: async args => {
        const tab = { ...args, id: nextId++, status: 'loading', windowId: 1 };
        tabs.set(tab.id, tab); calls.push(['create', args]); return tab;
      },
      update: async (id, args) => {
        if (!tabs.has(id)) throw new Error('No tab');
        const tab = { ...tabs.get(id), ...args }; tabs.set(id, tab);
        calls.push(['activate', id, args]); return tab;
      },
      get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
      remove: async id => { tabs.delete(id); calls.push(['remove', id]); },
      sendMessage: async (id, message) => {
        calls.push(['message', id, message]);
        return message.type === 'F4F_PING' ? probe : { ok: true };
      },
      onUpdated: { addListener: fn => { updated = fn; } },
      onRemoved: { addListener: fn => { removed = fn; } }
    }
  };
  let context;
  const restart = () => {
    context = vm.createContext({ chrome, crypto: webcrypto, console, URL, Date: class extends Date {
      static now() { return now; }
    } });
    vm.runInContext(workerSource, context);
  };
  restart();
  const popup = { url: 'chrome-extension://test/popup.html' };
  const page = id => ({ tab: { id }, frameId: 0, documentId: `document-${id}`, url: 'https://www.instagram.com/me/' });
  const dispatch = (message, sender = popup) => new Promise(resolve => handler(message, sender, resolve));
  let nextRequest = 0;
  const begin = details => {
    const request = { tabId: 2, frameId: 0, documentId: 'document-2', requestId: String(++nextRequest),
      initiator: 'https://www.instagram.com', url: 'https://www.instagram.com/api/v1/friendships/123/following/', ...details };
    beforeRequest(request);
    return request;
  };
  const respond = (request, details) => headersReceived({ ...request, statusCode: 429, ...details });
  return { dispatch, page, tabs, calls, chrome, restart, begin, respond,
    get now() { return now; },
    advance: ms => { now += ms; },
    response: details => respond(begin(details), details),
    requestError: details => requestError(details),
    get operation() { return operation; },
    set probe(value) { probe = value; },
    update: (id, change) => updated(id, change), remove: id => { tabs.delete(id); removed(id); },
    settle: async () => { await vm.runInContext('queue', context); } };
}
const scanning = () => harness([{ id: 2, url: 'https://www.instagram.com/me/' }],
  { status: 'running', tabId: 2, runId: 'scan' });
const retry = value => ({ responseHeaders: [{ name: 'Retry-After', value }] });
const requestRetry = h => h.dispatch({ type: 'F4F_RETRY', runId: 'scan' }, h.page(2));

test('only recognized top-frame list requests from the active document affect the scan', async () => {
  const h = scanning();
  for (const details of [{ tabId: 99 }, { frameId: 1 }, { documentId: 'stale' }, { statusCode: 200 },
    { initiator: 'https://example.com' }, { url: 'https://www.instagram.com/graphql/query' },
    { url: 'https://www.instagram.com/recommendations/friendships/123/following/' }]) h.response(details);
  await h.settle();
  assert.equal(h.operation.rateLimit, undefined);
  h.response({ ...retry('60'), url: 'https://www.instagram.com/api/v1/friendships/123/following/?max_id=cursor' });
  await h.settle();
  assert.equal(h.operation.retryAt, h.now + 60000);
  assert.equal(h.operation.reason, 'rate_limited');
  assert.deepEqual(h.operation.rateLimit, { receivedAt: h.now, list: 'following',
    category: 'pagination', attempt: 0, noRetryTime: false });
  assert.match(h.operation.message, /HTTP 429 while loading Following.+Instagram supplied the retry time/);
  assert.equal((await requestRetry(h)).retryUsed, undefined);
});

test('in-flight responses share one decision and keep the latest header even after a worker restart', async () => {
  const h = scanning();
  const first = h.begin({});
  const overlap = h.begin({});
  h.respond(first, retry('2'));
  await h.settle();
  h.restart();
  h.advance(2100);
  assert.equal((await requestRetry(h)).retryUsed, undefined);
  assert.equal(h.operation.reason, 'waiting_for_instagram');

  const later = new Date(h.now + 90000).toUTCString();
  h.respond(overlap, retry(later));
  await h.settle();
  assert.equal(h.operation.retryAt, Date.parse(later));
  assert.equal((await requestRetry(h)).retryUsed, undefined);
  h.advance(90000);
  assert.equal((await requestRetry(h)).retryUsed, true);
  h.restart();
  assert.equal((await h.dispatch({ type: 'F4F_START' })).runId, 'scan');
  h.response({ ...retry('3'), url: 'https://www.instagram.com/api/v1/friendships/123/followers/?query=synthetic' });
  await h.settle();
  assert.equal(h.operation.status, 'error');
  assert.equal(h.operation.rateLimit.attempt, 1);
  assert.equal(h.operation.rateLimit.list, 'followers');
  assert.equal(h.operation.rateLimit.category, 'search');
  assert.equal((await requestRetry(h)).status, 'error');
  assert.equal((await h.dispatch({ type: 'F4F_START' })).runId, 'scan');
});

test('a search replay can reset the focused field only in the running scan document after cooldown', async () => {
  const h = scanning();
  const injections = [];
  h.chrome.scripting.executeScript = async options => { injections.push(options); return [{ result: true }]; };
  const resetField = sender => h.dispatch({ type: 'F4F_RESET_SEARCH_FIELD', runId: 'scan' }, sender);
  h.response({ ...retry('2'), url: 'https://www.instagram.com/api/v1/friendships/123/following/?query=account' });
  await h.settle();
  assert.equal((await resetField(h.page(2))).ignored, true);
  h.advance(2100);
  assert.equal((await requestRetry(h)).retryUsed, true);
  assert.equal((await resetField({ ...h.page(2), documentId: 'stale' })).ignored, true);
  assert.equal(injections.length, 0);
  assert.equal((await resetField(h.page(2))).ok, true);
  assert.equal(injections[0].world, 'MAIN');
  assert.deepEqual(structuredClone(injections[0].target), { tabId: 2, documentIds: ['document-2'] });
});

test('a missing, malformed or expired Retry-After stops immediately and allows a manual attempt', async () => {
  for (const value of [undefined, '', '0', '1.5', '-10', '12/31/2099', 'Tue, 31 Feb 2099 00:00:00 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT', 'tomorrow']) {
    const h = scanning();
    h.response(retry(value));
    await h.settle();
    assert.equal(h.operation.status, 'error', value);
    assert.equal(h.operation.reason, 'rate_limited');
    assert.equal(h.operation.retryAt, undefined);
    assert.match(h.operation.message, /supplied no usable retry time.+Retry Checking/);
    assert.equal((await requestRetry(h)).status, 'error');
    h.probe = { runId: 'scan', running: false };
    assert.notEqual((await h.dispatch({ type: 'F4F_START' })).runId, 'scan');
  }
});

test('an unknown retry time stops an overlapping attempt and preserves an advertised later time', async () => {
  const h = scanning();
  const overlap = h.begin({});
  h.response({});
  await h.settle();
  assert.equal(h.operation.status, 'error');
  h.respond(overlap, retry('60'));
  await h.settle();
  assert.equal(h.operation.status, 'error');
  assert.equal(h.operation.retryAt, h.now + 60000);
  assert.match(h.operation.message, /no usable retry time.+Retry after/);
  h.advance(60001);
  assert.equal((await requestRetry(h)).status, 'error');
});

test('a long wait stops the check and expiry updates a stopped scan without a new Start', async () => {
  const h = scanning();
  h.response(retry('7200'));
  await h.settle();
  assert.equal(h.operation.status, 'error');
  assert.match(h.operation.message, /exceeds the time left.+Retry after/);
  h.advance(3600000);
  assert.equal((await h.dispatch({ type: 'F4F_STATUS' })).reason, 'rate_limited');
  assert.equal((await h.dispatch({ type: 'F4F_START' })).runId, 'scan');
  h.advance(3600001);
  const expired = await h.dispatch({ type: 'F4F_STATUS' });
  assert.equal(expired.status, 'error');
  assert.equal(expired.reason, undefined);
  assert.match(expired.message, /retry time has passed/);
  h.probe = { runId: 'scan', running: false };
  const next = await h.dispatch({ type: 'F4F_START' });
  assert.notEqual(next.runId, 'scan');
  assert.equal(next.retryAt, undefined);
});

test('cooldown expiry updates zero-row progress and only new rows clear the waiting notice', async () => {
  const h = scanning();
  const progress = { type: 'F4F_PROGRESS', runId: 'scan', list: 'followers', collected: 0, expected: 114 };
  await h.dispatch(progress, h.page(2));
  const cancelled = h.begin({});
  h.response(retry('3'));
  await h.settle();
  h.advance(3000);
  assert.equal((await h.dispatch({ type: 'F4F_COOLDOWN_STATUS', runId: 'scan' }, h.page(2))).reason, 'waiting_for_instagram');
  assert.match(h.operation.message, /0 of 114/);
  assert.equal((await requestRetry(h)).retryUsed, undefined);
  h.requestError(cancelled);
  await h.settle();
  assert.equal((await requestRetry(h)).retryUsed, true);
  await h.dispatch(progress, h.page(2));
  assert.equal(h.operation.reason, 'waiting_for_instagram');
  await h.dispatch({ ...progress, collected: 1 }, h.page(2));
  assert.equal(h.operation.reason, undefined);
});

test('the prior document cannot authorize a retry and reload preserves a known manual gate', async () => {
  const h = scanning();
  h.response(retry('60'));
  await h.settle();
  const reloaded = { ...h.page(2), documentId: 'reloaded' };
  assert.equal((await h.dispatch({ type: 'F4F_RETRY', runId: 'scan' }, reloaded)).ignored, true);
  const state = await h.dispatch({ type: 'F4F_PAGE_LOADED' }, reloaded);
  assert.equal(state.status, 'error');
  assert.equal(state.retryAt, h.now + 60000);
  assert.equal((await h.dispatch({ type: 'F4F_START' })).runId, 'scan');
});
test('start on another website reuses and foregrounds Instagram with no unrelated access', async () => {
  const h = harness([{ id: 1, url: 'https://youtube.com/', active: true },
    { id: 2, url: 'https://www.instagram.com/explore/' }]);
  const send = h.chrome.tabs.sendMessage;
  h.chrome.tabs.sendMessage = (id, message) => {
    if (message.type === 'F4F_PING') throw new Error('No content script');
    return send(id, message);
  };
  const result = await h.dispatch({ type: 'F4F_START' });
  assert.equal(result.status, 'waiting');
  assert.equal(result.tabId, 2);
  assert.ok(h.calls.some(call => call[0] === 'activate' && call[1] === 2 && call[2].active));
  assert.ok(h.calls.some(call => call[0] === 'focus'));
  assert.ok(!h.calls.some(call => call[0] === 'create'));
  assert.deepEqual(structuredClone(h.calls.find(call => call[0] === 'style')[1]),
    { target: { tabId: 2 }, files: ['verification.css'] });
});
test('start creates one visible tab when none exists and duplicate starts reuse it', async () => {
  const h = harness([{ id: 1, url: 'https://google.com/', active: true }]);
  await Promise.all([h.dispatch({ type: 'F4F_START' }), h.dispatch({ type: 'F4F_START' })]);
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(structuredClone(h.calls.find(call => call[0] === 'create')[1]), { url: 'https://www.instagram.com/', active: true });
  assert.equal(h.operation.status, 'waiting');
});
test('own-profile active tab is reused; only genuine result event marks completion', async () => {
  const h = harness([{ id: 3, url: 'https://www.instagram.com/me/', active: true }]);
  const operation = await h.dispatch({ type: 'F4F_START' });
  assert.equal(operation.tabId, 3);
  await h.dispatch({ type: 'F4F_READY', runId: operation.runId }, h.page(3));
  assert.equal(h.operation.status, 'running');
  assert.equal(h.calls.filter(call => call[0] === 'inject').length, 1);
  assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'inject')[1].files), ['collector.js', 'adapter.js', 'safe-runner.js']);
  await h.dispatch({ type: 'F4F_READY', runId: operation.runId }, h.page(3));
  assert.equal(h.calls.filter(call => call[0] === 'inject').length, 1);
  const results = { heading: 'Seni Takip Etmeyenler (1)', summary: 'Takip Ettiğin: 2 | Takipçi: 1', accounts: [{ name: 'a', href: '/a' }] };
  await h.dispatch({ type: 'F4F_FINISHED', runId: operation.runId, results, validation: verified }, h.page(3));
  assert.equal(h.operation.status, 'completed');
  assert.deepEqual(h.operation.results, results);
  await h.dispatch({ type: 'F4F_VIEW_RESULTS' });
  assert.equal(h.calls.at(-1)[2].type, 'F4F_SHOW_RESULTS');
});
test('login recovery and native profile identity persist without accepting a typed username', async () => {
  const h = harness([{ id: 4, url: 'https://www.instagram.com/accounts/login/', active: true }]);
  const op = await h.dispatch({ type: 'F4F_START' });
  await h.dispatch({ type: 'F4F_WAIT_STATUS', runId: op.runId,
    reason: 'login_required', message: 'Log in first.' }, h.page(4));
  assert.equal((await h.dispatch({ type: 'F4F_STATUS' })).reason, 'login_required');
  await h.dispatch({ type: 'F4F_CONTINUE', username: 'my.account' });
  assert.equal(h.operation.username, null);
  assert.ok(h.calls.some(call => call[0] === 'message' && call[2].type === 'F4F_RESET_WAIT'));
  await h.dispatch({ type: 'F4F_WAIT_STATUS', runId: op.runId, reason: 'profile_navigation',
    message: 'Opening your profile…', username: 'identified.account' }, h.page(4));
  await h.dispatch({ type: 'F4F_STATUS' });
  assert.equal(h.operation.username, 'identified.account');
  assert.ok(h.calls.some(call => call[0] === 'message' && call[2].type === 'F4F_ASSIST' &&
    call[2].username === 'identified.account'));
});
test('worker restart reads stored running state; stale page reports interruption', async () => {
  const op = { status: 'running', tabId: 5, runId: 'persisted', message: 'Checking' };
  const h = harness([{ id: 5, url: 'https://www.instagram.com/me/', active: true }], op);
  assert.equal((await h.dispatch({ type: 'F4F_STATUS' })).status, 'running');
  h.probe = { runId: null, running: false };
  assert.equal((await h.dispatch({ type: 'F4F_STATUS' })).reason, 'interrupted');
});
test('navigation/reload and closed tabs invalidate running state', async () => {
  for (const action of ['reload', 'close']) {
    const h = harness([{ id: 6, url: 'https://www.instagram.com/me/' }],
      { status: 'running', tabId: 6, runId: 'old' });
    if (action === 'reload') {
      h.probe = { runId: null, running: false };
      h.update(6, { status: 'complete' });
    } else h.remove(6);
    await h.settle();
    assert.equal(h.operation.status, 'error');
    assert.equal(h.operation.reason, 'interrupted');
  }
});
test('wrong tabs, subframes, stale runs and popup-spoofed finish events are ignored', async () => {
  const h = harness([{ id: 7, url: 'https://www.instagram.com/me/' }],
    { status: 'running', tabId: 7, runId: 'real' });
  const results = { heading: 'a', summary: 'b', accounts: [] };
  for (const [runId, sender] of [['wrong', h.page(7)], ['real', h.page(8)],
    ['real', { ...h.page(7), frameId: 1 }], ['real', undefined]]) {
    await h.dispatch({ type: 'F4F_FINISHED', runId, results }, sender);
    assert.equal(h.operation.status, 'running');
  }
});
test('list-route progress stays in the original scan tab', async () => {
  const h = harness([{ id: 2, url: 'https://www.instagram.com/me/' }],
    { status: 'running', tabId: 2, runId: 'recover', username: 'me' });
  const url = 'https://www.instagram.com/me/following/';
  const progress = { type: 'F4F_PROGRESS', runId: 'recover', list: 'following', collected: 108, expected: 114 };
  h.update(2, { status: 'loading', url });
  h.update(2, { status: 'complete' });
  await h.settle();
  assert.equal(h.operation.status, 'running');
  assert.equal((await h.dispatch(progress, { ...h.page(3), url })).ignored, true);
  const state = await h.dispatch(progress, { ...h.page(2), url });
  assert.equal(state.tabId, 2);
  assert.deepEqual({ ...state.progress }, { list: 'following', collected: 108, expected: 114 });
  assert.ok(h.calls.every(call => call[0] !== 'create'));
});
test('switching active tabs never restarts, completes or intentionally hides the checker', async () => {
  const h = harness([{ id: 8, url: 'https://www.instagram.com/me/', active: false }],
    { status: 'running', tabId: 8, runId: 'live' });
  h.probe = { runId: 'live', running: true };
  assert.equal((await h.dispatch({ type: 'F4F_STATUS' })).status, 'running');
  assert.ok(!h.calls.some(call => call[0] === 'inject' || call[0] === 'activate'));
});
test('failed injection and output-storage quota produce errors rather than success', async () => {
  const h = harness([{ id: 9, url: 'https://www.instagram.com/me/', active: true }]);
  const op = await h.dispatch({ type: 'F4F_START' });
  h.chrome.scripting.executeScript = async () => { throw new Error('Injection refused'); };
  await h.dispatch({ type: 'F4F_READY', runId: op.runId }, h.page(9));
  assert.equal(h.operation.status, 'error');
  assert.equal(h.operation.reason, 'injection_error');
  const quota = harness([{ id: 10, url: 'https://www.instagram.com/me/' }],
    { status: 'running', tabId: 10, runId: 'quota' });
  const set = quota.chrome.storage.session.set;
  quota.chrome.storage.session.set = async data => {
    if (data.operation.results) throw new Error('Quota'); return set(data);
  };
  await quota.dispatch({ type: 'F4F_FINISHED', runId: 'quota',
    results: { heading: 'h', summary: 's', accounts: [] }, validation: verified }, quota.page(10));
  assert.equal(quota.operation.status, 'error');
  assert.equal(quota.operation.reason, 'storage_error');
});
test('completed results can reopen in a new tab after the original was closed', async () => {
  const h = harness([], { status: 'completed', tabId: 11, runId: 'done',
    results: { heading: 'h', summary: 's', accounts: [] } });
  await h.dispatch({ type: 'F4F_VIEW_RESULTS' });
  assert.ok(h.operation.showResultsOnLoad);
  const id = h.operation.tabId;
  await h.dispatch({ type: 'F4F_PAGE_LOADED' }, h.page(id));
  assert.equal(h.operation.showResultsOnLoad, false);
  assert.ok(h.calls.some(call => call[0] === 'message' && call[2].type === 'F4F_SHOW_RESULTS'));
});

test('missing, rounded or incomplete collection evidence cannot publish non-followers', async () => {
  for (const validation of [undefined, { ...verified, verified: false },
    { ...verified, settled: undefined }, { ...verified, settled: false },
    { ...verified, followers: { expected: 10000, collected: 250 } },
    { ...verified, followers: { expected: 1.2, collected: 1.2 } },
    { ...verified, followers: { expected: 1, collected: Infinity } }]) {
    const h = harness([{ id: 12, url: 'https://www.instagram.com/me/' }],
      { status: 'running', tabId: 12, runId: 'safe' });
    await h.dispatch({ type: 'F4F_FINISHED', runId: 'safe', validation,
      results: { heading: 'h', summary: 's', accounts: [] } }, h.page(12));
    assert.equal(h.operation.status, 'error');
    assert.equal(h.operation.reason, 'incomplete_scan');
    assert.equal(h.operation.results, undefined);
  }
});

test('actual collection progress changes the message without marking completion', async () => {
  const h = harness([{ id: 13, url: 'https://www.instagram.com/me/' }],
    { status: 'running', tabId: 13, runId: 'progress' });
  await h.dispatch({ type: 'F4F_PROGRESS', runId: 'progress', list: 'followers', collected: 250, expected: 10000 }, h.page(13));
  assert.equal(h.operation.status, 'running');
  assert.match(h.operation.message, /250 of 10000/);
  await h.dispatch({ type: 'F4F_PROGRESS', runId: 'progress', list: 'followers', collected: 10001, expected: 10000 }, h.page(13));
  assert.equal(h.operation.message, 'Checking followers… 10001 found. Your profile shows 10000.');
  assert.equal(h.operation.status, 'running');
});

test('settled collection can retain deactivated accounts above the displayed count', async () => {
  const h = harness([{ id: 14, url: 'https://www.instagram.com/me/' }],
    { status: 'running', tabId: 14, runId: 'deactivated' });
  const validation = { ...verified, followers: { expected: 108, collected: 110 } };
  const results = { heading: 'h', summary: 's', accounts: [{ name: 'deactivated', href: '/deactivated' }] };
  await h.dispatch({ type: 'F4F_FINISHED', runId: 'deactivated', results, validation }, h.page(14));
  assert.equal(h.operation.status, 'completed');
  assert.deepEqual(h.operation.results, results);
});
