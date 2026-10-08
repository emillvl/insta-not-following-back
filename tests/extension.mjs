// Loads the real unpacked MV3 extension in an isolated temporary browser profile.
// Browser traffic is intercepted; this never uses an authenticated Instagram account.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const extensionPath = resolve('extension');
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
    const names=link.dataset.kind==='following'?['mutual','missing']:['mutual','fan'];
    for(const name of names){const row=document.createElement('a');row.style.cssText='display:block;height:70px';row.setAttribute('role','link');row.setAttribute('href','/'+name+'/');row.textContent=name;scroll.append(row)}
    dialog.append(close,scroll);document.body.append(dialog);
  }
  </script></body></html>`;
// Browser-created tabs can navigate before Playwright attaches interception.
// Resolve Instagram to our local TLS fixture and block every other network host.
const key = join(profile, 'fixture-key.pem');
const cert = join(profile, 'fixture-cert.pem');
const openssl = process.env.F4F_OPENSSL_PATH || (process.platform === 'win32' ?
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe') : 'openssl');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
  '-out', cert, '-days', '1', '-subj', '/CN=www.instagram.com'], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
    '--ignore-certificate-errors', '--no-proxy-server',
    `--host-resolver-rules=MAP www.instagram.com 127.0.0.1:${port}, MAP instagram.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`]
});
try {
  await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html', body: html }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  const workerErrors = [];
  worker.on('console', msg => { if (msg.type() === 'error') workerErrors.push(msg.text()); });
  const instagram = await context.newPage();
  await instagram.goto('https://www.instagram.com/me/');
  // Screenshot regression: the own page has Edit profile but no usable sidebar.
  await instagram.evaluate(() => document.getElementById('sidebar').remove());
  const instagramTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0]);
  // Accelerate only test-world timers after the real declarative scripts loaded.
  // Production code and its specified delays are left untouched on disk.
  await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const native = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => native(fn, 0, ...args);
  } }), instagramTab.id);
  const outside = await context.newPage();
  await outside.goto('https://youtube.com/');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#appearance').selectOption('dark');
  await popup.waitForFunction(() => document.documentElement.getAttribute('data-f4f-theme') === 'dark');
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
  // A separate run starts with no Instagram tabs and goes from home to own profile.
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
  await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const native = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => native(fn, 0, ...args);
  } }), createdTab.id);
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
  // A native list exposing fewer rows than its count must never publish a result.
  const createdPage = context.pages().find(page => page.url() === 'https://www.instagram.com/me/');
  await createdPage.evaluate(() => { document.querySelector('[data-kind="following"]').textContent = '3 following'; });
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
  assert.equal(operation.status, 'error');
  assert.equal(operation.reason, 'incomplete_scan');
  assert.equal(operation.results, undefined);
  assert.equal(await createdPage.locator('[data-f4f-results]').count(), 0);
  const errorView = await context.newPage();
  await errorView.goto(`chrome-extension://${extensionId}/popup.html`);
  await errorView.locator('#title').filter({ hasText: 'Incomplete scan' }).waitFor();
  assert.equal(await errorView.locator('#view').isVisible(), false);
  console.log('PASS: real MV3 incomplete list → retryable Incomplete scan, no View Results and no false non-follower box.');
  console.log('Isolated browser profile retained in the temporary directory; no signed-in profile was used.');
} finally { await context.close(); server.close(); }
