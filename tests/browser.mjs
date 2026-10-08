// Local browser fixtures only. No requests reach Instagram or a third party.
// Set F4F_PLAYWRIGHT_PATH to a bundled playwright package when not installed locally.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const source = readFileSync('f4fchecker.js', 'utf8');
const file = name => readFileSync(`extension/${name}`, 'utf8');
const browser = await chromium.launch({ channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
let checks = 0;
const native = { following: [['mutual', 'missing', 'mutual', 'explore', 'reels'], ['mutual', 'later', 'missing']],
  followers: [['mutual', 'fan'], ['mutual', 'fan']] };
function fixture(data, label, broken = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Instagram fixture</title></head><body style="margin:0;background:#f5f5f5;font-family:system-ui">
  <div id="sidebar" style="padding:24px"><div role="button"><a href="/me/"><span>Profile</span></a></div></div>
  <main style="margin:40px auto;max-width:700px"><h1>me <small>— test fixture</small></h1>
  <a href="/me/following/" data-list="following">Following</a> · <a href="/me/followers/" data-list="followers">Followers</a></main>
  <script>
  window.__data=${JSON.stringify(data)};window.__clicks=[];window.__timings=[];window.__alerts=[];
  const nativeTimeout=window.setTimeout.bind(window);
  window.setTimeout=(fn,ms,...args)=>{__timings.push(ms);return nativeTimeout(fn,0,...args)};
  window.alert=message=>__alerts.push(message);
  for(const link of document.querySelectorAll('[data-list]'))link.onclick=event=>{
    event.preventDefault();const type=link.dataset.list;__clicks.push('open:'+type);
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
    const close=document.createElement('${label === 'Kapat' ? 'span' : 'button'}');
    ${label === 'Kapat' ? `close.innerHTML='<svg aria-label="Kapat"></svg>';` : `close.setAttribute('aria-label',${JSON.stringify(label)});`}
    close.onclick=()=>{__clicks.push('close:'+type);dialog.remove()};
    const scroll=document.createElement('div');let pass=0;
    Object.defineProperty(scroll,'scrollHeight',{get:()=>${broken ? 0 : 1000}});
    Object.defineProperty(scroll,'clientHeight',{get:()=>100});
    Object.defineProperty(scroll,'scrollTop',{set:()=>{
      const snapshots=__data[type];const names=snapshots[Math.min(pass++,snapshots.length-1)];
      scroll.replaceChildren();for(const name of names){const row=document.createElement('a');row.setAttribute('role','link');row.setAttribute('href','/'+name+'/');row.textContent=name;scroll.append(row)}
    }});
    dialog.append(close,scroll);document.body.append(dialog);
  };
  window.__messages=[];window.__listeners=[];
  window.chrome={runtime:{id:'test',onMessage:{addListener:fn=>__listeners.push(fn)},sendMessage:async msg=>{
    __messages.push(msg);return msg.type==='F4F_FINISHED'?{status:'completed'}:{ok:true}
  }}};
  window.__dispatch=msg=>new Promise(resolve=>{for(const fn of __listeners)fn(msg,{id:'test'},resolve)});
  </script></body></html>`;
}
async function pageFor(data = native, label = 'Close', broken = false, path = '/me/') {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture(data, label, broken) }));
  await page.goto(`https://www.instagram.com${path}`);
  return page;
}
async function install(page) {
  await page.addScriptTag({ content: file('localization.js') });
  await page.addScriptTag({ content: file('list-controls.js') });
  await page.addScriptTag({ content: file('content.js') });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const box = document.getElementById('closeF4FBox')?.parentElement;
    return { heading: box?.querySelector('h3').textContent, summary: box?.querySelector('div').textContent.trim(),
      accounts: box ? [...box.querySelectorAll('li a')].map(a => ({ name: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel })) : [],
      clicks: __clicks, timings: __timings, alerts: __alerts };
  });
}
async function adapted(page) {
  await install(page);
  await page.evaluate(() => __dispatch({ type: 'F4F_ASSIST', runId: 'fixture' }));
  assert.ok((await page.evaluate(() => __dispatch({ type: 'F4F_CLAIM', runId: 'fixture' }))).ok);
  const shadowSafe = await page.evaluate(() => document.querySelectorAll('#f4f-warning').length === 1 &&
    document.querySelector('#f4f-warning').shadowRoot === null &&
    document.querySelectorAll('div[role="dialog"]').length === 0 &&
    getComputedStyle(document.querySelector('#f4f-warning')).pointerEvents === 'none');
  assert.ok(shadowSafe, 'warning must not expose checker-visible DOM or capture clicks');
  await page.addScriptTag({ content: file('adapter.js') });
  await page.addScriptTag({ content: file('checker-runner.js') });
  await page.waitForFunction(() => __messages.some(msg => ['F4F_FINISHED', 'F4F_FAILED'].includes(msg.type)));
  await page.waitForFunction(() => !F4FBridge.running);
}
try {
  for (const data of [native,
    { following: [['ALICE', 'alice', 'query?tab=1', 'explore', 'reels', 'accounts']], followers: [['alice', 'fan']] },
    { following: [[]], followers: [[]] }]) {
    for (const label of ['Close', 'Kapat']) {
      const baseline = await pageFor(data, label);
      await baseline.evaluate(source);
      const expected = await snapshot(baseline);
      assert.ok(expected.heading, `baseline failed: ${JSON.stringify(expected)}`);
      const page = await pageFor(data, label);
      await adapted(page);
      const actual = await snapshot(page);
      assert.deepEqual({ ...actual, timings: actual.timings.slice(0, expected.timings.length) }, expected);
      assert.equal(await page.evaluate(() => __messages.filter(m => m.type === 'F4F_FINISHED').length), 1);
      await page.locator('#closeF4FBox').click();
      assert.equal(await page.locator('[data-f4f-results]').count(), 0);
      const stored = await page.evaluate(() => __messages.find(m => m.type === 'F4F_FINISHED').results);
      await page.evaluate(results => __dispatch({ type: 'F4F_SHOW_RESULTS', results }), stored);
      assert.deepEqual((await snapshot(page)).accounts, expected.accounts);
      await baseline.close(); await page.close(); checks++;
    }
  }
  console.log('PASS: six differential full-script fixtures; outputs, ordering, filtering, clicks, delays and close/reopen actions match.');
  for (const label of ['Cerrar', 'Fermer', 'Schließen', 'Chiudi', 'Fechar', 'Закрыть', 'إغلاق', '閉じる', '닫기']) {
    const page = await pageFor(native, label);
    await adapted(page);
    const actual = await snapshot(page);
    assert.deepEqual(actual.accounts.map(account => account.name), ['missing', 'later'],
      `${label}: ${JSON.stringify(await page.evaluate(() => __messages))}`);
    assert.deepEqual(actual.clicks, ['open:following', 'close:following', 'open:followers', 'close:followers']);
    await page.close(); checks++;
  }
  console.log('PASS: nine additional localized close-control browser fixtures.');
  const controlBaseline = await pageFor();
  await controlBaseline.evaluate(source);
  const originalControlTrace = await snapshot(controlBaseline);
  await controlBaseline.close();
  for (const kind of ['absolute', 'slashless', 'button', 'role-link', 'bare-span', 'split-label']) {
    const page = await pageFor();
    await page.evaluate(kind => {
      for (const type of ['following', 'followers']) {
        const old = document.querySelector(`[data-list="${type}"]`);
        if (kind === 'absolute' || kind === 'slashless') {
          old.setAttribute('href', `${kind === 'absolute' ? 'https://www.instagram.com' : ''}/me/${type}`);
          continue;
        }
        const control = document.createElement(kind === 'button' ? 'button' : 'div');
        if (kind === 'role-link') control.setAttribute('role', 'link');
        // The following label reproduces the nested spans provided by the user;
        // the follower count was provided alone, so include the visible label
        // from the screenshot in its enclosing native control.
        control.innerHTML = type === 'following' ?
          '<span class="x1lliihq x1plvlek xryxfnj" dir="auto"><span class="x5n08af x1s688f"><span class="html-span xdj266r x14z9mp">104</span></span> following</span>' :
          '<span class="html-span xdj266r x14z9mp xat24cr">108</span> followers';
        if (kind === 'split-label') control.innerHTML = `<span>${type === 'following' ? '104' : '108'}</span> <span>${type}</span>`;
        control.onclick = old.onclick;
        old.replaceWith(control);
      }
    }, kind);
    if (!['absolute', 'slashless'].includes(kind)) {
      assert.equal(await page.locator('a[href*="/following"], a[href*="/followers"]').count(), 0);
    }
    await adapted(page);
    const actual = await snapshot(page);
    assert.deepEqual(actual.accounts.map(account => account.name), ['missing', 'later'], kind);
    assert.deepEqual(actual.clicks, ['open:following', 'close:following', 'open:followers', 'close:followers'], kind);
    assert.deepEqual(actual.timings.slice(0, originalControlTrace.timings.length), originalControlTrace.timings, kind);
    await page.close(); checks++;
  }
  const unrelated = await pageFor();
  await install(unrelated);
  await unrelated.evaluate(() => {
    document.querySelector('[data-list="following"]').remove();
    const article = document.createElement('article');
    article.innerHTML = '<button>104 following</button>';
    document.querySelector('main').append(article);
    const wrong = document.createElement('a'); wrong.href = '/other_user/following/'; wrong.textContent = '104 following';
    document.querySelector('main').append(wrong);
  });
  assert.equal(await unrelated.evaluate(() => F4FListControls.find(document, 'me', 'following') === null), true);
  await unrelated.close(); checks++;
  console.log('PASS: absolute/slashless URLs, buttons, role links, supplied nested label spans, bubbling native handlers and rejection of post/other-account controls.');
  const failure = await pageFor(native, 'Close', true);
  await adapted(failure);
  assert.equal(await failure.evaluate(() => __messages.some(m => m.type === 'F4F_FINISHED')), false);
  assert.match(await failure.evaluate(() => __messages.find(m => m.type === 'F4F_FAILED').message), /Kaydırılabilir/);
  await failure.close(); checks++;
  const navigation = await pageFor(native, 'Close', false, '/explore/');
  await install(navigation);
  await navigation.evaluate(() => {
    document.querySelector('#sidebar a').addEventListener('click', () => sessionStorage.setItem('nativeProfileClicked', 'yes'));
    return __dispatch({ type: 'F4F_ASSIST', runId: 'navigation' });
  });
  await navigation.waitForURL('https://www.instagram.com/me/');
  assert.equal(await navigation.evaluate(() => sessionStorage.getItem('nativeProfileClicked')), 'yes');
  await navigation.close(); checks++;
  const manual = await pageFor(native, 'Close', false, '/someone_else/');
  await install(manual);
  await manual.evaluate(() => {
    document.querySelector('#sidebar').remove();
    return __dispatch({ type: 'F4F_ASSIST', runId: 'manual' });
  });
  await manual.waitForFunction(() => __messages.some(m => m.reason === 'waiting_profile'));
  await manual.evaluate(() => { const now = Date.now; Date.now = () => now() + 20000; });
  assert.equal(await manual.evaluate(() => __messages.some(m => m.type === 'F4F_READY')), false);
  await manual.evaluate(() => {
    history.replaceState({}, '', '/me/');
    const edit = document.createElement('a'); edit.href = '/accounts/edit/'; edit.textContent = 'Edit profile';
    document.querySelector('main').append(edit);
  });
  await manual.waitForFunction(() => __messages.some(m => m.type === 'F4F_READY'));
  await manual.close(); checks++;
  // Reproduce the screenshot: own profile with Edit profile, but no recognizable sidebar.
  for (const label of ['Edit profile', 'Profili düzenle']) {
    const own = await pageFor(native, 'Close', false, '/me');
    await own.evaluate(label => {
      document.querySelector('#sidebar').remove();
      const edit = document.createElement('a'); edit.href = '/accounts/edit/'; edit.textContent = label;
      document.querySelector('main').append(edit);
    }, label);
    await adapted(own);
    assert.deepEqual((await snapshot(own)).accounts.map(account => account.name), ['missing', 'later']);
    await own.close(); checks++;
  }
  // Mobile/icon controls carry the label in an SVG instead of an avatar or text.
  const icon = await pageFor(native, 'Close', false, '/someone_else/');
  await install(icon);
  await icon.evaluate(() => {
    const link = document.querySelector('#sidebar a'); link.innerHTML = '<svg aria-label="Profile"></svg>';
    return __dispatch({ type: 'F4F_ASSIST', runId: 'icon' });
  });
  await icon.waitForURL('https://www.instagram.com/me/');
  await icon.close(); checks++;
  // A button-only Profile action navigates through Instagram's own SPA handler.
  const buttonProfile = await pageFor(native, 'Close', false, '/explore/');
  await install(buttonProfile);
  await buttonProfile.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Profile';
    document.querySelector('#sidebar').replaceChildren(button);
    button.onclick = () => {
      history.replaceState({}, '', '/me/');
      const edit = document.createElement('button'); edit.textContent = 'Edit profile';
      document.querySelector('main').append(edit);
    };
    return __dispatch({ type: 'F4F_ASSIST', runId: 'button' });
  });
  await buttonProfile.waitForFunction(() => __messages.some(m => m.type === 'F4F_READY'));
  assert.equal(new URL(buttonProfile.url()).pathname, '/me/');
  await buttonProfile.close(); checks++;
  const login = await pageFor(native, 'Close', false, '/accounts/login/');
  await install(login);
  await login.evaluate(() => __dispatch({ type: 'F4F_ASSIST', runId: 'login' }));
  await login.waitForFunction(() => __messages.some(m => m.reason === 'login_required'));
  assert.equal(await login.evaluate(() => __messages.some(m => m.type === 'F4F_READY')), false);
  await login.evaluate(() => history.replaceState({}, '', '/me/'));
  await login.waitForFunction(() => __messages.some(m => m.type === 'F4F_READY'));
  await login.close(); checks++;
  const timeout = await pageFor();
  await install(timeout);
  await timeout.evaluate(() => {
    document.querySelector('[data-list="followers"]').remove();
    return __dispatch({ type: 'F4F_ASSIST', runId: 'timeout' });
  });
  await timeout.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; });
  await timeout.waitForFunction(() => __messages.some(m => m.reason === 'readiness_error'));
  assert.equal(await timeout.evaluate(() => __messages.some(m => m.type === 'F4F_READY')), false);
  await timeout.close(); checks++;
  console.log('PASS: native Profile click without nav/avatar, own Edit profile regression, manual navigation after 15 seconds, icon/button controls, login gating/resume and readiness timeout.');

  // Visual fixtures use the actual popup HTML/CSS/JS with a fake extension API.
  const server = createServer((req, res) => {
    const name = req.url.split('/').pop();
    if (!['popup.html', 'popup.css', 'popup.js'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(file(name));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const visual = await browser.newPage({ viewport: { width: 360, height: 660 }, reducedMotion: 'reduce' });
    const errors = [];
    visual.on('pageerror', error => errors.push(error.message));
    await visual.addInitScript(() => {
      window.__state = { status: 'idle' }; window.__sent = []; window.__storageListener = null;
      window.chrome = { runtime: { sendMessage: async msg => { __sent.push(msg); return __state; } },
        storage: { onChanged: { addListener: fn => { __storageListener = fn; } } } };
      window.__render = state => { __state = state; __storageListener({ operation: { newValue: state } }, 'session'); };
    });
    await visual.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    for (const state of [
      { status: 'idle', message: 'Ready' },
      { status: 'running', message: 'Checking following, then followers…' },
      { status: 'completed', message: 'Checking Complete', results: { heading: 'Seni Takip Etmeyenler (2)', summary: 'Takip Ettiğin: 4 | Takipçi: 2', accounts: [] } },
      { status: 'error', message: 'Instagram was reloaded. Please retry.' },
      { status: 'waiting', reason: 'waiting_profile', message: 'Waiting for Instagram’s Profile control…' },
      { status: 'waiting', reason: 'login_required', message: 'Log in to Instagram in this tab. Checking will continue after login.' }
    ]) {
      await visual.evaluate(state => __render(state), state);
      assert.ok(await visual.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const visibleButtons = await visual.locator('button:visible').all();
      for (const button of visibleButtons) {
        const box = await button.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 360 && box.height >= 44);
      }
      await visual.screenshot({ path: `artifacts/popup-${state.reason || state.status}.png`, fullPage: true });
      checks++;
    }
    assert.equal(await visual.locator('input, form').count(), 0);
    await visual.locator('#continue').click();
    assert.ok(await visual.evaluate(() => __sent.some(msg => msg.type === 'F4F_CONTINUE' && !('username' in msg))));
    assert.deepEqual(errors, []);
    await visual.close();
    const results = await pageFor();
    await install(results);
    await results.evaluate(() => __dispatch({ type: 'F4F_SHOW_RESULTS', results: {
      heading: 'Seni Takip Etmeyenler (16)', summary: 'Takip Ettiğin: 40 | Takipçi: 24',
      accounts: Array.from({ length: 16 }, (_, i) => ({ name: 'fixture_account_' + (i + 1), href: '/fixture_account_' + (i + 1) }))
    } }));
    await results.screenshot({ path: 'artifacts/results-desktop.png' });
    await results.setViewportSize({ width: 320, height: 640 });
    const bounds = await results.locator('[data-f4f-results]').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.height <= 640);
    await results.screenshot({ path: 'artifacts/results-narrow.png' });
    await results.evaluate(() => F4FBridge.warning('running'));
    await results.setViewportSize({ width: 1200, height: 800 });
    await results.screenshot({ path: 'artifacts/warning-running.png' });
    await results.close(); checks++;
    console.log('PASS: six popup state renders, login continuation with no username form, result links/close, responsive result bounds and warning screenshots.');
  } finally { server.close(); }
  console.log(`Browser fixture checks passed: ${checks}. Actual authenticated Instagram remains a manual test.`);
} finally { await browser.close(); }
