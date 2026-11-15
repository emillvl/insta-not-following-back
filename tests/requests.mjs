import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unpackedFixture } from './unpacked-fixture.mjs';

const healthy = {
  following: ['mutual', 'missing'], followers: ['mutual', 'fan'], expected: ['missing']
};
const names = Array.from({ length: 114 }, (_, index) => `follow_${index + 1}`);
const omitted = names.slice(20, 23);
const distinct = names.filter(name => !omitted.includes(name));
const short = {
  following: names.slice(0, 108), followers: [names[0], 'fan'],
  extra: names.slice(108), stallFirstPage: true, expected: names.slice(1)
};
const duplicates = {
  following: [...distinct, ...distinct.slice(0, 3)], followingTotal: 114,
  followers: ['fan', 'inactive_account', ...names.slice(0, -1)], followersTotal: 114,
  labels: { fan: 'Follow Back', inactive_account: 'Deactivated account', [omitted[0]]: 'Following' },
  searchable: true, expected: names.slice(-1)
};
const paginated = { ...healthy, extra: ['later'], expected: ['missing', 'later'] };
const pathPattern = /^\/api\/v1\/friendships\/123\/(following|followers)\/$/;

function pageScript(config) {
  const metrics = window.metrics = { opens: [], searches: [], searchPresentation: [] };
  for (const control of document.querySelectorAll('[data-list]')) {
    control.onclick = async event => {
      event.preventDefault();
      const list = control.dataset.list;
      metrics.opens.push(list);
      if (config.unrelated && list === 'following') void fetch('/api/v1/feed/timeline/');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const close = document.createElement('button');
      close.setAttribute('aria-label', 'Close');
      close.onclick = () => dialog.remove();
      const area = document.createElement('div');
      area.dataset.fixtureScroll = '';
      area.style.cssText = `overflow-y:auto;height:${config.following.length > 2 ? 100 : 20}px`;
      const row = (name, label) => {
        const link = document.createElement('a');
        link.setAttribute('role', 'link');
        link.href = `/${name}/`;
        link.textContent = name;
        if (!label) link.style.cssText = 'display:block;height:20px';
        if (!label) return link;
        const group = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = label;
        group.append(link, button);
        return group;
      };
      const request = async (phase, query = '') => {
        dialog.setAttribute('aria-busy', 'true');
        const url = `/api/v1/friendships/123/${list}/?${phase === 'page' ? 'max_id=page' : query}`;
        const overlap = config.overlap === `${list}.${phase}` && metrics.opens.filter(opened => opened === list).length === 1;
        const responses = await Promise.all([fetch(url), ...(overlap ?
          [fetch(url + (url.endsWith('?') ? '' : '&') + 'overlap=1')] : [])]);
        // A rejected opening intentionally leaves a loading shell attached.
        if (responses.every(response => response.ok) || phase !== 'open') dialog.removeAttribute('aria-busy');
        return responses.every(response => response.ok);
      };
      if (config.searchable && list === 'following') {
        const input = document.createElement('input');
        input.type = 'search';
        input.oninput = async () => {
          const name = input.value;
          metrics.searches.push(name);
          metrics.searchPresentation.push([getComputedStyle(dialog).opacity, dialog.inert]);
          area.replaceChildren();
          if (config.replaceOnSearch) {
            const replacement = dialog.cloneNode(true);
            replacement.querySelector('button').onclick = () => replacement.remove();
            dialog.replaceWith(replacement);
          }
          if (await request('search', `query=${encodeURIComponent(name)}`) && dialog.isConnected) {
            area.append(row(name, config.labels[name] || 'Following'));
          }
        };
        dialog.append(input);
      }
      dialog.append(close, area);
      document.body.append(dialog);
      if (!await request('open') || !dialog.isConnected) return;
      area.append(...config[list].map(name => row(name, list === 'followers' ? config.labels?.[name] : undefined)));
      if (list !== 'following' || !config.extra) return;
      let atEnd = false, pending = false, loaded = false, visits = 0, leftPreload = false;
      area.onscroll = async () => {
        const wasAtEnd = atEnd;
        atEnd = area.scrollTop + area.clientHeight >= area.scrollHeight - 2;
        if (visits && area.scrollTop === 0) leftPreload = true;
        if (!atEnd || wasAtEnd || pending || loaded || (visits && config.stallFirstPage && !leftPreload)) return;
        visits++;
        pending = true;
        try {
          if (await request('page') && dialog.isConnected && (!config.stallFirstPage || visits > 1)) {
            loaded = true;
            area.append(...config.extra.map(name => row(name)));
          }
        } finally { pending = false; }
      };
    };
  }
}

const benchmark = process.argv.includes('--benchmark');
const only = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
const extensionPath = resolve(process.env.F4F_TEST_EXTENSION || 'extension');
let current;
const fixture = await unpackedFixture((req, res) => {
  const url = new URL(req.url, 'https://www.instagram.com');
  const list = url.pathname.match(pathPattern)?.[1];
  res.setHeader('Cache-Control', 'no-store');
  if (list || url.pathname === '/api/v1/feed/timeline/') {
    const category = list ? `${list}.${url.searchParams.has('query') ? 'search' :
      url.searchParams.has('max_id') ? 'page' : 'open'}` : 'feed';
    const index = current.requests.filter(request => request.category === category).length;
    const rejection = current.reject?.(category, index);
    const request = { category, status: rejection ? 429 : 200, at: Date.now() };
    current.requests.push(request);
    const respond = () => {
      if (rejection?.header !== undefined) res.setHeader('Retry-After', rejection.header);
      request.respondedAt = Date.now();
      res.writeHead(request.status).end();
    };
    if (rejection?.delay) setTimeout(respond, rejection.delay);
    else respond();
    return;
  }
  if (url.pathname !== '/me/') { res.writeHead(404).end(); return; }
  const count = list => current[`${list}Total`] ?? current[list].length +
    (list === 'following' ? current.extra?.length || 0 : 0);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Isolated F4F fixture</title><body>
    <nav><a href="/me/">Profile</a></nav><main><a href="/accounts/edit/">Edit profile</a>
    <a href="/me/following/" data-list="following">${count('following')} following</a>
    <a href="/me/followers/" data-list="followers">${count('followers')} followers</a></main>
    <script>(${pageScript})(${JSON.stringify(current)});</script></body>`);
}, extensionPath);

const { context, extensionId } = fixture;
let { worker } = fixture;
const read = () => worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
const popupURL = `chrome-extension://${extensionId}/popup.html`;
const openPopup = async () => {
  const popup = await context.newPage();
  await popup.goto(popupURL);
  return popup;
};
async function until(predicate, timeout = 20000) {
  const end = Date.now() + timeout;
  let state;
  do {
    state = await read();
    if (predicate(state)) return state;
    await delay(50);
  } while (Date.now() < end);
  throw new Error(`Unexpected operation: ${JSON.stringify(state)}. Requests: ${JSON.stringify(current.requests)}`);
}
const finished = (state, previous) => state && state.runId !== previous &&
  ['completed', 'error'].includes(state.status);
const clock = ({ realStart, scale }) => {
  const nativeNow = Date.now.bind(Date);
  const nativeTimeout = globalThis.setTimeout;
  globalThis.f4fRestoreClock = () => { Date.now = nativeNow; globalThis.setTimeout = nativeTimeout; };
  Date.now = () => realStart + (nativeNow() - realStart) * scale;
  globalThis.setTimeout = (fn, ms = 0, ...args) => nativeTimeout(fn, ms / scale, ...args);
};
async function scenario(name, config, { scale = 12, checks = 1, verify } = {}) {
  if (only && !name.includes(only)) return;
  current = { ...config, requests: [] };
  await worker.evaluate(() => chrome.storage.session.clear());
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/me/');
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/me/' }))[0].id);
  await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    globalThis.fixtureScrollWrites = 0;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      ...scrollTop,
      set(value) {
        if (this.hasAttribute('data-fixture-scroll')) globalThis.fixtureScrollWrites++;
        scrollTop.set.call(this, value);
      }
    });
  } }), tab);
  const realStart = Date.now();
  if (scale !== 1) {
    await worker.evaluate(clock, { realStart, scale });
    await worker.evaluate(({ tab, args }) =>
      chrome.scripting.executeScript({ target: { tabId: tab }, func: args => {
        const nativeNow = Date.now.bind(Date);
        const nativeTimeout = globalThis.setTimeout;
        Date.now = () => args.realStart + (nativeNow() - args.realStart) * args.scale;
        globalThis.setTimeout = (fn, ms = 0, ...parameters) => nativeTimeout(fn, ms / args.scale, ...parameters);
      }, args: [args] }), { tab, args: { realStart, scale } });
  }
  let previous;
  let lastScrollWrites = 0;
  try {
    for (let index = 0; index < checks; index++) {
      const popup = await openPopup();
      if (index) {
        current.requests.length = 0;
        await page.evaluate(() => Object.assign(metrics, { opens: [], searches: [] }));
      }
      const started = Date.now();
      await popup.locator(index ? '#again' : '#start').click();
      const running = { page, previous, until, requests: current.requests, realStart, scale };
      const result = await (verify ? verify(running) : until(state => finished(state, previous), scale === 1 ? 115000 : 125000));
      const wallMs = Date.now() - started;
      const metrics = await page.evaluate(() => window.metrics);
      const [{ result: scrollWrites }] = await worker.evaluate(id =>
        chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.fixtureScrollWrites }), tab);
      const requestCounts = {};
      for (const request of current.requests) requestCounts[request.category] = (requestCounts[request.category] || 0) + 1;
      console.log(JSON.stringify({ name, check: index + 1, openings: metrics.opens.join(','),
        scrollWrites: scrollWrites - lastScrollWrites, searches: metrics.searches.length, requests: requestCounts, wallMs, scale,
        status: result.status, progress: result.progress, verified: result.validation && {
          following: result.validation.following.collected, followers: result.validation.followers.collected } }));
      previous = result.runId;
      lastScrollWrites = scrollWrites;
    }
  } finally {
    await worker.evaluate(() => globalThis.f4fRestoreClock?.()).catch(() => {});
    await page.close();
  }
}

const categories = requests => requests.map(request => request.category);
const repeated = (category, count) => Array(count).fill(category);
const startFrom = popup => popup.evaluate(() => chrome.runtime.sendMessage({ type: 'F4F_START' }));
const openOrder = ['following.open', 'followers.open'];
const duplicateOrder = [...openOrder, 'following.open'];
async function assertBanner(page, pattern) {
  const session = await context.newCDPSession(page);
  try {
    for (let i = 0; i < 20; i++) {
      const { nodes } = await session.send('Accessibility.getFullAXTree');
      if (nodes.some(node => pattern.test(node.name?.value))) return;
      await delay(50);
    }
    assert.fail(`Page banner did not match ${pattern}`);
  } finally { await session.detach(); }
}
async function assertClean(page) {
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') &&
    !document.documentElement.hasAttribute('data-f4f-verifying'));
}
function assertResult(state, config) {
  assert.equal(state.status, 'completed', state.message);
  assert.deepEqual(state.results.accounts.map(account => account.name), config.expected);
}

try {
  if (benchmark) {
    await scenario('healthy', healthy, { scale: 1, checks: 2 });
    await scenario('108 of 114', short, { scale: 1 });
    await scenario('114 records / 111 unique', duplicates, { scale: 1 });
    await scenario('persistent 429 with no retry time', { ...paginated,
      reject: category => category === 'following.page' && {} }, { scale: 24 });
  } else {
    await scenario('two healthy scans ignore unrelated first-party 429', {
      ...healthy, unrelated: true, reject: category => category === 'feed' && {}
    }, { checks: 2, verify: async ({ until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assertResult(state, healthy);
      assert.deepEqual(categories(requests).filter(category => category !== 'feed'), openOrder);
      assert.equal(requests.filter(request => request.category === 'feed' && request.status === 429).length, 1);
      return state;
    } });
    await scenario('108 of 114', short, { verify: async ({ until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assertResult(state, short);
      assert.deepEqual(state.validation.following, { expected: 114, collected: 114 });
      assert.deepEqual(categories(requests), ['following.open', 'following.page', 'following.page', 'followers.open']);
      return state;
    } });
    await scenario('114 records / 111 unique', duplicates, { verify: async ({ page, until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assertResult(state, duplicates);
      assert.deepEqual(state.validation.following, { expected: 114, collected: 114 });
      assert.deepEqual(categories(requests), [...duplicateOrder, ...repeated('following.search', 2)]);
      assert.deepEqual(await page.evaluate(() => metrics.searches), omitted.slice(1));
      assert.deepEqual(await page.evaluate(() => metrics.searchPresentation), [['0', true], ['0', true]]);
      await assertClean(page);
      return state;
    } });
    await scenario('persistent pagination 429 stops until a manual retry', { ...paginated,
      reject: category => category === 'following.page' && {}
    }, { scale: 24, verify: async ({ page, until, previous, requests, scale }) => {
      const state = await until(state => finished(state, previous));
      assert.equal(state.status, 'error');
      assert.match(state.message, /HTTP 429 while loading Following at .+supplied no usable retry time/);
      await assertClean(page);
      const popup = await openPopup();
      await popup.locator('#start').filter({ hasText: 'Retry Checking' }).waitFor();
      assert.equal(await popup.locator('#start').isEnabled(), true);
      await assertBanner(page, /supplied no usable retry time/);
      await delay(65000 / scale);
      assert.deepEqual(categories(requests), ['following.open', 'following.page']);
      await popup.locator('#start').click();
      const manual = await until(next => finished(next, state.runId));
      assert.equal(manual.status, 'error');
      assert.deepEqual(categories(requests), ['following.open', 'following.page', 'following.open', 'following.page']);
      return manual;
    } });
    await scenario('malformed opening 429 has a manual action with no invented cooldown', { ...healthy,
      reject: category => category === 'following.open' && { header: '12/31/2099' }
    }, { verify: async ({ page, until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assert.equal(state.status, 'error');
      assert.equal(state.retryAt, undefined);
      await assertClean(page);
      assert.deepEqual(categories(requests), ['following.open']);
      return state;
    } });
    await scenario('long opening wait survives a full reload', { ...healthy,
      reject: category => category === 'following.open' && { header: '1201' }
    }, { scale: 1, verify: async ({ page, until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assert.equal(state.status, 'error');
      assert.match(state.message, /retry time exceeds the time left/);
      const popup = await openPopup();
      await popup.locator('#start').waitFor();
      assert.equal(await popup.locator('#start').isDisabled(), true);
      await page.reload();
      await assertBanner(page, /retry time exceeds the time left/);
      assert.equal((await startFrom(popup)).runId, state.runId);
      assert.deepEqual(categories(requests), ['following.open']);
      return state;
    } });
    await scenario('overlapping opening 429s, worker restart, and a rejected single retry', { ...healthy,
      overlap: 'following.open',
      reject(category, index) {
        if (category !== 'following.open') return;
        if (index === 1) return { header: new Date(Date.now() + 8500).toUTCString(), delay: 4200 };
        return { header: '2' };
      }
    }, { scale: 1, verify: async ({ page, until, requests }) => {
      const first = await until(state => state?.reason === 'rate_limited');
      const view = await openPopup();
      await view.locator('#title').filter({ hasText: 'Instagram rate limit' }).waitFor();
      assert.deepEqual((await Promise.all([startFrom(view), startFrom(view)])).map(state => state.runId),
        [first.runId, first.runId]);
      await worker.evaluate(() => { globalThis.fixtureRestartMarker = true; });
      const session = await context.newCDPSession(view);
      await session.send('ServiceWorker.enable');
      await session.send('ServiceWorker.stopAllWorkers');
      await session.detach();
      const readback = await view.evaluate(() => chrome.runtime.sendMessage({ type: 'F4F_STATUS' }));
      assert.equal(readback.runId, first.runId);
      worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 5000 });
      assert.equal(await worker.evaluate(() => globalThis.fixtureRestartMarker), undefined);

      const waiting = await until(state => state?.reason === 'waiting_for_instagram');
      assert.match(waiting.message, /0 of 2/);
      await assertBanner(page, /0 of 2/);
      assert.deepEqual(categories(requests), repeated('following.open', 2));
      const extended = await until(state => state?.retryAt > first.retryAt);
      assert.equal(extended.status, 'running');
      assert.deepEqual(categories(requests), repeated('following.open', 2));
      const stoppedAgain = await until(state => state?.status === 'error');
      assert.equal(stoppedAgain.rateLimit.attempt, 1);
      assert.deepEqual(categories(requests), repeated('following.open', 3));
      assert.ok(requests[2].at >= extended.retryAt, 'no retry before the latest Retry-After');
      await view.locator('#start').waitFor();
      assert.equal(await view.locator('#start').isDisabled(), true);
      await view.locator('#start:enabled').waitFor({ timeout: 6500 });
      await assertBanner(page, /retry time has passed/);
      await assertClean(page);
      assert.deepEqual(categories(requests), repeated('following.open', 3));
      return stoppedAgain;
    } });
    await scenario('a no-header 429 stops hidden exact verification and restores the page', { ...duplicates, replaceOnSearch: true,
      reject: category => category === 'following.search' && {}
    }, { verify: async ({ page, until, previous, requests }) => {
      const state = await until(state => finished(state, previous));
      assert.equal(state.status, 'error');
      assert.equal(state.rateLimit.category, 'search');
      assert.equal(state.results, undefined);
      await assertClean(page);
      assert.deepEqual(categories(requests), [...duplicateOrder, 'following.search']);
      assert.deepEqual(await page.evaluate(() => metrics.searchPresentation), [['0', true]]);
      assert.equal(await page.locator('[data-f4f-results]').count(), 0);
      return state;
    } });
    await scenario('a valid exact-search replay uses one permit and keeps searches hidden', { ...duplicates,
      reject: (category, index) => category === 'following.search' && index === 0 && { header: '8' }
    }, { verify: async ({ page, until, previous, requests, realStart, scale }) => {
      const paused = await until(state => state?.reason === 'rate_limited');
      assert.deepEqual(categories(requests), [...duplicateOrder, 'following.search']);
      const state = await until(state => finished(state, previous));
      assertResult(state, duplicates);
      await assertClean(page);
      assert.deepEqual(categories(requests), [...duplicateOrder, ...repeated('following.search', 3)]);
      assert.ok(realStart + (requests[4].at - realStart) * scale >= paused.retryAt);
      assert.deepEqual(await page.evaluate(() => metrics.searches), [omitted[1], ...omitted.slice(1)]);
      assert.deepEqual(await page.evaluate(() => metrics.searchPresentation), repeated(['0', true], 3));
      return state;
    } });
  }
} finally { await fixture.close(); }
