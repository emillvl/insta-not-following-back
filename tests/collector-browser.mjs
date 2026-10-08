import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectorFixture } from './collector-fixture.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true });
const records = [];
async function run(options, baseline = false, real = false) {
  const page = await browser.newPage();
  if (!real) { await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000)); }
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: collectorFixture(options) }));
  await page.goto('https://www.instagram.com/me/');
  const started = Date.now();
  if (baseline) {
    void page.evaluate(readFileSync('f4fchecker.js', 'utf8')).catch(() => {});
  } else {
    for (const file of ['localization.js', 'list-controls.js', 'collector.js', 'adapter.js', 'safe-runner.js']) {
      await page.addScriptTag({ content: readFileSync(`extension/${file}`, 'utf8') });
    }
  }
  if (!real) {
    for (let i = 0; i < 300; i++) {
      if (await page.evaluate(() => Boolean(window.__done || window.__failed || __alerts.length))) break;
      await page.clock.runFor(1000);
    }
  } else await page.waitForFunction(() => Boolean(window.__done || window.__failed || document.getElementById('closeF4FBox')), null, { timeout: 180000 });
  const result = await page.evaluate(() => ({ done: window.__done, failed: window.__failed,
    alerts: __alerts, scrolls: __scrolls, clicks: __clicks, progress: __progress,
    originalAccounts: [...document.querySelectorAll('#closeF4FBox + h3 + div + ul li a')].map(a => a.textContent),
    originalSummary: document.getElementById('closeF4FBox')?.parentElement.querySelector('div').textContent.trim(),
    resultsPresent: Boolean(document.getElementById('closeF4FBox')),
    dialogsRemaining: document.querySelectorAll('div[role="dialog"]').length,
    listElapsedMs: Date.now() - window.__listOpenedAt }));
  result.wallMs = Date.now() - started;
  await page.close();
  return result;
}
try {
  const timingOnly = process.argv.includes('--timing-only');
  const regressionOnly = process.argv.includes('--dialog-regressions');
  for (const options of timingOnly ? [] : [
    { name: '1000 cumulative', size: 1000 }, { name: '2000 cumulative', size: 2000 },
    { name: '10000 cumulative', size: 10000, batch: 250 },
    { name: '1000 virtual rows', size: 1000, mode: 'virtual' },
    { name: '10000 virtual rows', size: 10000, mode: 'virtual' },
    { name: '2000 recycled anchors', size: 2000, mode: 'recycled' },
    { name: 'slow virtual renderer', size: 200, mode: 'virtual', renderDelay: 1200 },
    { name: '18-second delayed batches', size: 200, batch: 100, delay: 18000 },
    { name: 'container replacement', size: 1000, mode: 'replace-container' },
    { name: 'dialog replacement', size: 1000, replaceDialog: true },
    { name: 'dialog replacement after a render gap', size: 1000, replaceDialog: true, replacementGap: 1200 },
    { name: 'opening dialog placeholder replacement', size: 1000, openingPlaceholder: true, replacementGap: 1200 },
    { name: 'dialog ancestor wrapper replacement', size: 1000, replaceDialog: true, replaceWrapper: true, replacementGap: 1200 },
    { name: 'virtual dialog replacement midway through collection', size: 1000, mode: 'virtual', replaceAtScroll: 20, replacementGap: 1200 },
    { name: 'non-scrolling small lists', size: 2, mode: 'all' },
    { name: 'both lists empty', size: 0, mode: 'all' },
    { name: 'rounded label with exact title', size: 1000, rounded: true, exactTitle: true }
  ].filter(options => !regressionOnly || options.name.includes('dialog'))) {
    const result = await run(options);
    assert.equal(result.failed, undefined, `${options.name}: ${JSON.stringify(result)}`);
    assert.ok(result.done, `${options.name}: no completion`);
    assert.deepEqual(result.done.accounts, options.size === 0 ? [] : ['missing'], options.name);
    assert.deepEqual(result.done.validation.followers, { expected: options.size, collected: options.size });
    assert.equal(result.done.validation.verified, true);
    assert.equal(result.dialogsRemaining, 0, `${options.name}: list left open`);
    records.push({ name: options.name, status: 'verified', scrolls: result.scrolls, wallMs: result.wallMs });
    console.log('PASS:', options.name);
  }
  for (const options of timingOnly ? [] : [
    { name: 'stalled list', size: 1000, mode: 'stall', reason: 'incomplete_scan' },
    { name: 'unverifiable rounded total', size: 1000, rounded: true, reason: 'unverified_count' },
    { name: 'profile changes during scan', size: 1000, changedCount: true, reason: 'incomplete_scan' },
    { name: 'more rows than advertised', size: 1000, smallerTotal: true, reason: 'incomplete_scan' },
    { name: 'list closes during loading', size: 1000, delay: 18000, closeDuringLoad: true, reason: 'interrupted' },
    { name: 'dialog does not return within recovery limit', size: 1000, replaceDialog: true, replacementGap: 4000, reason: 'interrupted' },
    { name: 'repeated dialog replacements without progress', size: 1000, mode: 'stall', replaceDialog: true, replaceTimes: 6, reason: 'interrupted' },
    { name: 'hard deadline', size: 1000, jumpClock: true, reason: 'incomplete_scan' }
  ]) {
    const result = await run(options);
    assert.equal(result.done, undefined, `${options.name}: published incomplete results`);
    assert.equal(result.failed?.reason, options.reason, `${options.name}: ${JSON.stringify(result)}`);
    assert.equal(result.resultsPresent, false);
    if (options.replaceDialog || options.closeDuringLoad) assert.ok(result.listElapsedMs <= 5000, `${options.name}: interruption was not bounded`);
    records.push({ name: options.name, status: options.reason, scrolls: result.scrolls, wallMs: result.wallMs });
    console.log('PASS:', options.name, '→ no false results');
  }
  if (process.argv.includes('--real-timing') || process.argv.includes('--real-large')) {
    const options = process.argv.includes('--real-large') ?
      { size: 10000, mode: 'cumulative', batch: 250, delay: 50 } : { size: 2, mode: 'all', viewport: 20 };
    const [original, safer] = await Promise.all([run(options, true, true), run(options, false, true)]);
    assert.deepEqual(original.originalAccounts, ['missing']);
    assert.deepEqual(safer.done.accounts, ['missing']);
    assert.equal(original.originalSummary, safer.done.summary);
    assert.ok(safer.wallMs < original.wallMs, 'healthy validated collection must beat original fixture time');
    records.push({ name: `unshortened healthy timing (${options.size} followers)`, originalMs: original.wallMs, validatedMs: safer.wallMs });
    console.log(`PASS: real timers; original ${original.wallMs}ms, validated ${safer.wallMs}ms; identical accounts.`);
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(process.argv.includes('--real-large') ? 'artifacts/collector-large-timing.json' :
    'artifacts/collector-verification.json', JSON.stringify(records, null, 2));
  console.log('Collector checks passed:', records.length, '(local fixtures; live Instagram loading is not simulated exactly).');
} finally { await browser.close(); }
