// Differential execution with real browser timers: no fast clock or shortened waits.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const original = readFileSync('f4fchecker.js', 'utf8');
const browser = await chromium.launch({ channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true });
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<a href="/me/following/" data-kind="following">104 following</a>
<a href="/me/followers/" data-kind="followers">108 followers</a>
<script>
window.__waits=[];window.__clicks=[];window.__stability=[];window.__errors=[];
const realTimeout=window.setTimeout.bind(window);
window.setTimeout=(callback,ms,...args)=>{
  const wait={requested:ms,started:performance.now()};__waits.push(wait);
  return realTimeout(()=>{wait.elapsed=performance.now()-wait.started;callback(...args)},ms);
};
window.alert=message=>__errors.push(message);
const log=console.log.bind(console);
console.log=(...args)=>{const text=args.join(' ');if(text.includes('stability:'))__stability.push(text);log(...args)};
for(const link of document.querySelectorAll('[data-kind]'))link.onclick=event=>{
  event.preventDefault();const type=link.dataset.kind;__clicks.push('open:'+type);
  const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
  const close=document.createElement('button');close.setAttribute('aria-label','Close');
  close.onclick=()=>{__clicks.push('close:'+type);dialog.remove()};
  const scroll=document.createElement('div');scroll.style.cssText='height:100px;overflow-y:auto';
  for(const name of type==='following'?['mutual','missing']:['mutual','fan']){
    const row=document.createElement('a');row.setAttribute('role','link');row.setAttribute('href','/'+name+'/');
    row.textContent=name;row.style.cssText='display:block;height:80px';scroll.append(row);
  }
  dialog.append(close,scroll);document.body.append(dialog);
};
</script></body></html>`;
async function run(adapted) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://www.instagram.com/me/');
  if (adapted) {
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('[data-kind]')) {
        const button = document.createElement('button');
        button.innerHTML = `<span>${link.dataset.kind === 'following' ? '104' : '108'}</span> ${link.dataset.kind}`;
        button.onclick = link.onclick;
        link.replaceWith(button);
      }
    });
  }
  const start = Date.now();
  if (!adapted) await page.evaluate(original);
  else {
    await page.evaluate(() => {
      globalThis.F4FBridge = { claimed: true, running: true,
        finish: () => { globalThis.__finished = true; },
        fail: error => { __errors.push(error.message); globalThis.__finished = true; }
      };
    });
    for (const name of ['localization.js', 'list-controls.js', 'adapter.js', 'checker-runner.js']) {
      await page.addScriptTag({ content: readFileSync(`extension/${name}`, 'utf8') });
    }
    await page.waitForFunction(() => globalThis.__finished, null, { timeout: 90000 });
  }
  const result = await page.evaluate(() => ({
    heading: document.getElementById('closeF4FBox')?.parentElement.querySelector('h3').textContent,
    accounts: [...document.querySelectorAll('#closeF4FBox + h3 + div + ul li a')].map(a => a.textContent),
    waits: __waits, clicks: __clicks, stability: __stability, errors: __errors
  }));
  result.wallTime = Date.now() - start;
  await page.close();
  return result;
}
try {
  // Independent contexts execute concurrently, using actual timers in each page.
  const [baseline, adapted] = await Promise.all([run(false), run(true)]);
  for (const [name, result] of [['original', baseline], ['extension runner', adapted]]) {
    assert.deepEqual(result.errors, [], name);
    assert.deepEqual(result.accounts, ['missing'], name);
    assert.deepEqual(result.clicks, ['open:following', 'close:following', 'open:followers', 'close:followers'], name);
    assert.equal(result.waits.filter(wait => wait.requested === 3000).length, 2, name);
    assert.equal(result.waits.filter(wait => wait.requested === 2000).length, 5, name);
    assert.equal(result.waits.filter(wait => wait.requested === 1500).length, 22, name);
    assert.equal(result.stability.filter(text => text.endsWith('8/8')).length, 2, name);
    for (const wait of result.waits) assert.ok(wait.elapsed >= wait.requested - 20,
      `${name}: ${wait.requested}ms wait ran for ${wait.elapsed}ms`);
    assert.ok(result.wallTime >= 49000 - 100, name);
    console.log(`${name}: ${result.wallTime}ms real execution; 2 × 3000ms, 5 × 2000ms, 22 × 1500ms; both lists reached stability 8/8.`);
  }
  assert.deepEqual(adapted.waits.map(wait => wait.requested), baseline.waits.map(wait => wait.requested));
  assert.deepEqual(adapted.stability, baseline.stability);
  assert.equal(adapted.heading, baseline.heading);
  console.log('PASS: original and packaged runner have identical clicks, results, requested waits and stability sequence with unaccelerated timers. This does not verify live Instagram control markup.');
} finally { await browser.close(); }
