import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const channel = process.env.F4F_BROWSER_CHANNEL || 'msedge';
const extensionPath = resolve('extension');
const retrySeconds = 8;
const followingRequests = [];
const listPages = new Map();
const profile = mkdtempSync(join(tmpdir(), 'f4f-extension-test-'));
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="sidebar"><a href="/me/"><span>Profile</span></a></div>
  <main><a id="edit" href="/accounts/edit/">Edit profile</a>
  <button data-kind="following"><span dir="auto"><span><span class="html-span">2</span></span> following</span></button>
  <div role="button" data-kind="followers"><span class="html-span">2</span> followers</div>
  </main>
  <script>
  if(!['/me','/me/'].includes(location.pathname))document.getElementById('edit').remove();
  for(const link of document.querySelectorAll('[data-kind]'))link.onclick=event=>{
    event.preventDefault();const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    const close=document.createElement('button');close.setAttribute('aria-label','Fermer');close.onclick=()=>dialog.remove();
    const scroll=document.createElement('div');scroll.style.cssText='height:100px;overflow-y:auto';
    const names=window.__listAccounts?.[link.dataset.kind]?.slice()??
      (link.dataset.kind==='following'?['mutual','missing']:['mutual','fan']);
    if(window.__includeDeactivated)names.push('deactivated_one','deactivated_two');
    const addRow=name=>{const row=document.createElement('a');row.style.cssText='display:block;height:70px';row.setAttribute('role','link');row.setAttribute('href','/'+name+'/');row.textContent=name;
      if(link.dataset.kind==='following'&&name==='mutual')row.removeAttribute('role');
      if(link.dataset.kind==='following'&&name==='missing')row.href='https://www.instagram.com/missing/';
      scroll.append(row);};
    names.forEach(addRow);
    if(window.__limitFollowing&&link.dataset.kind==='following'){
      let atEnd=false,pending=false,loaded=false;
      scroll.addEventListener('scroll',async()=>{
        const wasAtEnd=atEnd;
        atEnd=scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2;
        if(!atEnd||wasAtEnd||pending||loaded)return;
        pending=true;
        try{
          const response=await fetch('/f4f-fixture/following-page');
          if(response.ok){loaded=true;addRow('later');}
        }finally{pending=false;}
      });
    }
    dialog.append(close,scroll);
    if(link.dataset.kind==='followers'){
      const placeholder=document.createElement('div');placeholder.setAttribute('role','dialog');
      document.body.append(placeholder);
      queueMicrotask(()=>{placeholder.replaceWith(dialog);window.__dialogReplacements=(window.__dialogReplacements||0)+1;});
    }else document.body.append(dialog);
  }
  </script></body></html>`;
const key = join(profile, 'fixture-key.pem');
const cert = join(profile, 'fixture-cert.pem');
const openssl = process.env.F4F_OPENSSL_PATH || (process.platform === 'win32' ?
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe') : 'openssl');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
  '-out', cert, '-days', '1', '-subj', '/CN=www.instagram.com'], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  if (req.url === '/f4f-fixture/following-page') {
    followingRequests.push(Date.now());
    if (followingRequests.length === 1) {
      res.writeHead(429, { 'Retry-After': retrySeconds, 'Cache-Control': 'no-store' });
    }
    res.end(); return;
  }
  const list = req.url.match(/^\/me\/(following|followers)\/$/)?.[1];
  if (list) {
    if (listPages.has(list)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(listPages.get(list));
    } else res.writeHead(302, { Location: '/other_account/' }).end();
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const extensionArgs = channel === 'chrome' ? ['--enable-unsafe-extension-debugging'] :
  [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`];
const context = await chromium.launchPersistentContext(profile, {
  channel, headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], ignoreHTTPSErrors: true,
  args: [...extensionArgs, '--disable-gpu', '--ignore-certificate-errors', '--no-proxy-server',
    `--host-resolver-rules=MAP www.instagram.com 127.0.0.1:${port}, MAP instagram.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`]
});
try {
  if (channel === 'chrome') {
    const session = await context.browser().newBrowserCDPSession();
    await session.send('Extensions.loadUnpacked', { path: extensionPath });
    await session.detach();
  }
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.href === 'https://www.instagram.com/f4f-fixture/following-page') return route.continue();
    if (url.origin === 'https://www.instagram.com' && /^\/me\/(following|followers)\/$/.test(url.pathname)) return route.continue();
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  const accelerateTimers = tabId => worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    const native = globalThis.setTimeout;
    let now = Date.now();
    Date.now = () => now;
    globalThis.setTimeout = (fn, ms = 0, ...args) => {
      if (ms > 120000) return native(fn, ms, ...args);
      const due = now + ms;
      return native(() => {
        now = Math.max(now, due);
        fn(...args);
      }, 0);
    };
  } }), tabId);
  const workerErrors = [];
  worker.on('console', msg => { if (msg.type() === 'error') workerErrors.push(msg.text()); });
  const instagram = await context.newPage();
  await instagram.goto('https://www.instagram.com/me/');
  await instagram.evaluate(() => document.getElementById('sidebar').remove());
  const instagramTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0]);
  await accelerateTimers(instagramTab.id);
  const outside = await context.newPage();
  await outside.goto('https://youtube.com/');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#appearance').selectOption('dark');
  await popup.waitForFunction(() => document.documentElement.getAttribute('data-f4f-theme') === 'dark');
  assert.equal(await popup.locator('.author').textContent(), 'By Emil Valiyev');
  assert.ok(await popup.locator('.logo-dark').evaluate(img => img.complete && img.naturalWidth === 128));
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().action.default_icon['32']), 'icons/icon-32.png');
  await popup.locator('#start').click();
  try { await instagram.waitForSelector('[data-f4f-results]', { timeout: 15000 }); }
  catch (error) {
    console.log('Extension state:', await worker.evaluate(() => chrome.storage.session.get('operation')));
    console.log('Worker errors:', workerErrors);
    console.log('Popup status:', await popup.locator('body').textContent().catch(() => 'closed'));
    console.log('Instagram dialogs:', await instagram.locator('[role="dialog"]').count());
    throw error;
  }
  let operation;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    operation = await worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
    if (operation?.status === 'completed') break;
    if (operation?.status === 'error') throw new Error(operation.message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(operation.status, 'completed');
  assert.equal(operation.validation.verified, true);
  assert.deepEqual(operation.validation.followers, { expected: 2, collected: 2 });
  assert.deepEqual(operation.results.accounts, [{ name: 'missing', href: '/missing' }]);
  assert.equal(operation.tabId, instagramTab.id);
  assert.equal(await instagram.evaluate(() => window.__dialogReplacements), 1);
  assert.equal(await instagram.locator('[role="dialog"]').count(), 0);
  const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.instagram.com/*' }));
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].active, true);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await reopened.locator('#view').waitFor({ state: 'visible' });
  assert.equal(await reopened.locator('input, form').count(), 0);
  assert.match(await reopened.locator('#title').textContent(), /Checking Complete/);
  assert.equal(await reopened.locator('#appearance').inputValue(), 'dark');
  await instagram.waitForFunction(() => document.querySelector('[data-f4f-results]').getAttribute('data-f4f-theme') === 'dark');
  assert.equal(await instagram.locator('[data-f4f-results]').evaluate(box => getComputedStyle(box).backgroundColor), 'rgb(12, 16, 20)');
  await reopened.locator('#appearance').selectOption('light');
  await instagram.waitForFunction(() => document.querySelector('[data-f4f-results]').getAttribute('data-f4f-theme') === 'light');
  await reopened.emulateMedia({ colorScheme: 'dark' });
  await instagram.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await reopened.getAttribute('html', 'data-f4f-theme'), 'light');
  assert.equal(await instagram.getAttribute('[data-f4f-results]', 'data-f4f-theme'), 'light');
  await reopened.locator('#appearance').selectOption('system');
  await reopened.waitForFunction(() => document.documentElement.getAttribute('data-f4f-theme') === 'dark');
  await instagram.waitForFunction(() => document.querySelector('[data-f4f-results]').getAttribute('data-f4f-theme') === 'dark');
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation.results), operation.results);
  await instagram.locator('#closeF4FBox').click();
  await reopened.locator('#view').click();
  await instagram.waitForSelector('[data-f4f-results]');
  assert.deepEqual(await instagram.locator('[data-f4f-results] li a').allTextContents(), ['missing']);
  assert.deepEqual(workerErrors, []);
  console.log('PASS: real unpacked MV3 load, own-page Edit profile without sidebar, active tab reuse, popup-independent execution, localized modal close, genuine completion, session state on reopening and View Results without username input.');
  console.log('PASS: real local-storage appearance persistence, popup-to-content changes, Light overriding OS Dark, and live System mode without changing checker results.');
  console.log('PASS: packaged extension icons, theme logo, and Emil Valiyev credit load in the real popup.');
  console.log('PASS: real isolated-world collection survives replacement of the opening Instagram dialog and closes its replacement.');
  await instagram.close();
  await worker.evaluate(() => chrome.storage.session.clear());
  const newPopup = await context.newPage();
  await newPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await newPopup.locator('#start').click();
  const started = Date.now();
  let createdTab;
  while (Date.now() - started < 10000) {
    createdTab = (await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.instagram.com/*' })))[0];
    if (createdTab?.url === 'https://www.instagram.com/me/') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(createdTab.url, 'https://www.instagram.com/me/', JSON.stringify(
    await worker.evaluate(() => chrome.storage.session.get('operation'))));
  assert.equal(createdTab.active, true);
  await accelerateTimers(createdTab.id);
  const newDeadline = Date.now() + 15000;
  while (Date.now() < newDeadline) {
    operation = await worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
    if (operation?.status === 'completed') break;
    if (operation?.status === 'error') throw new Error(operation.message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(operation.status, 'completed');
  assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.instagram.com/*' }))).length, 1);
  console.log('PASS: no existing Instagram tab → one foreground tab → own profile → automatic checking and completion with no second Start.');
  const createdPage = context.pages().find(page => page.url() === 'https://www.instagram.com/me/');
  await createdPage.evaluate(() => { window.__includeDeactivated = true; });
  await worker.evaluate(() => chrome.storage.session.clear());
  const extraPopup = await context.newPage();
  await extraPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await extraPopup.locator('#start').click();
  const extraDeadline = Date.now() + 15000;
  while (Date.now() < extraDeadline) {
    operation = await worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
    if (operation?.status === 'completed') break;
    if (operation?.status === 'error') throw new Error(operation.message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(operation.status, 'completed');
  assert.equal(operation.validation.settled, true);
  assert.deepEqual(operation.validation.followers, { expected: 2, collected: 4 });
  assert.deepEqual(operation.validation.following, { expected: 2, collected: 4 });
  assert.deepEqual(operation.results.accounts, [{ name: 'missing', href: '/missing' }]);
  assert.match(operation.results.summary, /Takip Ettiğin: 4 \| Takipçi: 4/);
  console.log('PASS: real MV3 completion retains deactivated rows above displayed counts after settling.');
  await createdPage.evaluate(() => { window.__includeDeactivated = false; document.querySelector('[data-kind="following"]').textContent = '3 following'; });
  await worker.evaluate(() => chrome.storage.session.clear());
  const incompletePopup = await context.newPage();
  await incompletePopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await incompletePopup.locator('#start').click();
  const errorDeadline = Date.now() + 10000;
  while (Date.now() < errorDeadline) {
    operation = await worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
    if (operation?.status === 'error') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(operation.status, 'error', JSON.stringify({ operation, tabs: await worker.evaluate(() => chrome.tabs.query({
    url: 'https://www.instagram.com/*'
  })) }));
  assert.equal(operation.reason, 'incomplete_scan');
  assert.equal(operation.message, 'F4F Checker verified 2 of 3 accounts you follow after trying Instagram’s /following/ page. No comparison was made.');
  assert.equal(operation.results, undefined);
  assert.equal(await createdPage.locator('[data-f4f-results]').count(), 0);
  const errorView = await context.newPage();
  await errorView.goto(`chrome-extension://${extensionId}/popup.html`);
  await errorView.locator('#title').filter({ hasText: 'Incomplete scan' }).waitFor();
  assert.equal(await errorView.locator('#message').textContent(), operation.message);
  assert.equal(await errorView.locator('#view').isVisible(), false);
  console.log('PASS: real MV3 incomplete list → retryable Incomplete scan, no View Results and no false non-follower box.');

  const followingNames = Array.from({ length: 114 }, (_, index) => `follow_${index + 1}`);
  const accountRows = names => names.map(name => `<a role="link" href="/${name}/" style="display:block;height:90px">${name}</a>`).join('');
  listPages.set('following', `<!doctype html><main><h1>Following</h1>${accountRows(followingNames.slice(98))}</main>
    <aside>${accountRows(['unrelated_suggestion'])}</aside>`);
  listPages.set('followers', `<!doctype html><section role="dialog"><div style="height:100px;overflow:auto">
    ${accountRows(['follow_1', 'follow_114'])}</div></section>`);
  await createdPage.evaluate(names => {
    window.__listAccounts = { following: names.slice(0, 108), followers: ['follow_1'] };
    document.querySelector('[data-kind="following"]').textContent = '114 following';
  }, followingNames);
  await worker.evaluate(() => chrome.storage.session.clear());
  const openedListPages = [];
  const accelerateListPage = async page => {
    await page.waitForURL(url => /\/me\/(following|followers)\/$/.test(url.pathname), { timeout: 20000 });
    openedListPages.push(new URL(page.url()).pathname);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, page.url());
    await accelerateTimers(tabId);
  };
  const pageTasks = [];
  const captureListPage = page => { pageTasks.push(accelerateListPage(page)); };
  await errorView.reload();
  context.on('page', captureListPage);
  await errorView.locator('#start').click();
  const readOperation = () => worker.evaluate(async () => (await chrome.storage.session.get('operation')).operation);
  const waitForOperation = async (predicate, timeout) => {
    const end = Date.now() + timeout;
    let state;
    do {
      state = await readOperation();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < end && state?.status !== 'error');
    throw new Error(`Unexpected extension state: ${JSON.stringify(state)}`);
  };
  const recovered = await waitForOperation(state => state?.status === 'completed', 30000);
  context.off('page', captureListPage);
  await Promise.all(pageTasks);
  assert.deepEqual(openedListPages, ['/me/following/', '/me/followers/']);
  assert.deepEqual(recovered.validation.following, { expected: 114, collected: 114 });
  assert.deepEqual(recovered.validation.followers, { expected: 2, collected: 2 });
  assert.deepEqual(recovered.results.accounts.map(account => account.name), followingNames.slice(1, -1));
  assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.instagram.com/*' }))).length, 1);
  console.log('PASS: both native list URLs are read when short, merging six missed accounts and closing the temporary tabs.');

  await createdPage.close();
  await worker.evaluate(() => chrome.storage.session.clear());
  const limitedPage = await context.newPage();
  await limitedPage.goto('https://www.instagram.com/me/');
  await limitedPage.evaluate(() => {
    window.__limitFollowing = true;
    document.querySelector('[data-kind="following"]').textContent = '3 following';
  });
  const ratePopup = await context.newPage();
  await ratePopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await ratePopup.locator('#start').click();
  const paused = await waitForOperation(state => state?.reason === 'rate_limited', 15000);
  assert.equal(paused.status, 'running');
  assert.ok(paused.retryAt >= followingRequests[0] + retrySeconds * 1000);
  assert.equal(followingRequests.length, 1);
  const pauseView = await context.newPage();
  await pauseView.goto(`chrome-extension://${extensionId}/popup.html`);
  await pauseView.locator('#title').filter({ hasText: 'Instagram rate limit' }).waitFor({ timeout: 4000 });
  assert.match(await pauseView.locator('#message').textContent(), /Next attempt after/);
  await limitedPage.bringToFront();
  const waitingForRows = await waitForOperation(state => state?.reason === 'waiting_for_instagram', 15000);
  assert.match(waitingForRows.message, /2 of 3/);
  assert.equal(followingRequests.length, 1);
  await pauseView.locator('#title').filter({ hasText: 'Waiting for Instagram' }).waitFor({ timeout: 4000 });
  const accessibility = await context.newCDPSession(limitedPage);
  const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
  assert.ok(nodes.some(node => node.name?.value === 'Waiting for Instagram'));
  assert.ok(nodes.some(node => node.name?.value === waitingForRows.message));
  await accessibility.detach();
  const resumed = await waitForOperation(state => state?.status === 'completed', 90000);
  assert.equal(followingRequests.length, 2);
  assert.ok(followingRequests[1] >= paused.retryAt, 'retried before Retry-After');
  assert.ok(followingRequests[1] < paused.retryAt + 30000, 'rescan fell back to the ordinary stall timeout');
  assert.deepEqual(resumed.validation.following, { expected: 3, collected: 3 });
  assert.deepEqual(resumed.results.accounts, [{ name: 'missing', href: '/missing' }, { name: 'later', href: '/later' }]);
  console.log('PASS: real MV3 HTTP 429 shows a next-attempt time and waits for new rows before resuming.');
  console.log('Isolated browser profile retained in the temporary directory; no signed-in profile was used.');
} finally { await context.close(); server.close(); }
