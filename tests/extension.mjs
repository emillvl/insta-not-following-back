// Loads the real unpacked MV3 extension in an isolated temporary browser profile.
// Browser traffic is intercepted; this never uses an authenticated Instagram account.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const extensionPath = resolve('extension');
const profile = mkdtempSync(join(tmpdir(), 'f4f-extension-test-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <nav><a href="/me/"><img alt=""><span>Profile</span></a></nav>
  <a href="/me/following/" data-kind="following">Following</a>
  <a href="/me/followers/" data-kind="followers">Followers</a>
  <script>
  for(const link of document.querySelectorAll('[data-kind]'))link.onclick=event=>{
    event.preventDefault();const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    const close=document.createElement('button');close.setAttribute('aria-label','Fermer');close.onclick=()=>dialog.remove();
    const scroll=document.createElement('div');scroll.style.cssText='height:100px;overflow-y:auto';
    const names=link.dataset.kind==='following'?['mutual','missing']:['mutual','fan'];
    for(const name of names){const row=document.createElement('a');row.style.cssText='display:block;height:70px';row.setAttribute('role','link');row.setAttribute('href','/'+name+'/');row.textContent=name;scroll.append(row)}
    dialog.append(close,scroll);document.body.append(dialog);
  }
  </script></body></html>`;
try {
  await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html', body: html }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  const workerErrors = [];
  worker.on('console', msg => { if (msg.type() === 'error') workerErrors.push(msg.text()); });
  const instagram = await context.newPage();
  await instagram.goto('https://www.instagram.com/me/');
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
  assert.deepEqual(operation.results.accounts, [{ name: 'missing', href: '/missing' }]);
  assert.equal(operation.tabId, instagramTab.id);
  const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.instagram.com/*' }));
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].active, true);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await reopened.locator('#view').waitFor({ state: 'visible' });
  assert.match(await reopened.locator('#title').textContent(), /Checking Complete/);
  await instagram.locator('#closeF4FBox').click();
  await reopened.locator('#view').click();
  await instagram.waitForSelector('[data-f4f-results]');
  assert.deepEqual(await instagram.locator('[data-f4f-results] li a').allTextContents(), ['missing']);
  assert.deepEqual(workerErrors, []);
  console.log('PASS: real unpacked MV3 load, worker, Instagram-only content injection, active tab reuse, popup-independent execution, localized modal close, genuine completion, session state on reopening and View Results.');
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
  assert.equal(createdTab.url, 'https://www.instagram.com/me/');
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
  console.log('Isolated browser profile retained in the temporary directory; no signed-in profile was used.');
} finally { await context.close(); }
