import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const workerSource = readFileSync('extension/service-worker.js', 'utf8');
const verified = { verified: true, settled: true, following: { expected: 2, collected: 2 }, followers: { expected: 1, collected: 1 } };
function harness(initialTabs = [], initialOperation) {
  let operation = initialOperation;
  let nextId = 100;
  const tabs = new Map(initialTabs.map(tab => [tab.id, { status: 'complete', windowId: 1, ...tab }]));
  const calls = [];
  let handler, updated, removed;
  let probe = { runId: initialOperation?.runId, running: true };
  const chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener: fn => { handler = fn; } } },
    storage: { session: {
      get: async () => ({ operation }), set: async data => { operation = structuredClone(data.operation); }
    } },
    action: { setBadgeText: async args => calls.push(['badge', args.text]), setBadgeBackgroundColor: async () => {} },
    windows: { update: async (id, args) => { calls.push(['focus', id, args]); } },
    scripting: { executeScript: async args => { calls.push(['inject', args]); } },
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
      sendMessage: async (id, message) => {
        calls.push(['message', id, message]);
        return message.type === 'F4F_PING' ? probe : { ok: true };
      },
      onUpdated: { addListener: fn => { updated = fn; } },
      onRemoved: { addListener: fn => { removed = fn; } }
    }
  };
  const context = vm.createContext({ chrome, crypto: webcrypto, console });
  vm.runInContext(workerSource, context);
  const popup = { url: 'chrome-extension://test/popup.html' };
  const page = id => ({ tab: { id }, frameId: 0, url: 'https://www.instagram.com/me/' });
  const dispatch = (message, sender = popup) => new Promise(resolve => handler(message, sender, resolve));
  return { dispatch, page, tabs, calls, chrome, context,
    get operation() { return operation; },
    set probe(value) { probe = value; },
    update: (id, change) => updated(id, change), remove: id => { tabs.delete(id); removed(id); },
    settle: async () => { await vm.runInContext('queue', context); } };
}
test('start on another website reuses and foregrounds Instagram with no unrelated access', async () => {
  const h = harness([{ id: 1, url: 'https://youtube.com/', active: true },
    { id: 2, url: 'https://www.instagram.com/explore/' }]);
  const result = await h.dispatch({ type: 'F4F_START' });
  assert.equal(result.status, 'waiting');
  assert.equal(result.tabId, 2);
  assert.ok(h.calls.some(call => call[0] === 'activate' && call[1] === 2 && call[2].active));
  assert.ok(h.calls.some(call => call[0] === 'focus'));
  assert.ok(!h.calls.some(call => call[0] === 'create'));
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
    if (action === 'reload') h.update(6, { status: 'loading' }); else h.remove(6);
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
  assert.match(h.operation.message, /10001 accounts \(profile shows 10000\)/);
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
