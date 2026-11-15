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
    for (let i = 0; i < 2000; i++) {
      if (await page.evaluate(() => Boolean(window.__done || window.__failed || __alerts.length))) break;
      await page.clock.runFor(1000);
    }
  } else await page.waitForFunction(() => Boolean(window.__done || window.__failed || document.getElementById('closeF4FBox')), null, { timeout: 180000 });
  const result = await page.evaluate(() => ({ done: window.__done, failed: window.__failed,
    alerts: __alerts, scrolls: __scrolls, clicks: __clicks, progress: __progress,
    originalAccounts: [...document.querySelectorAll('#closeF4FBox + h3 + div + ul li a')].map(a => a.textContent),
    originalSummary: document.getElementById('closeF4FBox')?.parentElement.querySelector('div').textContent.trim(),
    resultsPresent: Boolean(document.getElementById('closeF4FBox')),
    followingEndVisits: __followingEndVisits, comparisonCreated: __comparisonCreated,
    searches: __searches,
    dialogsRemaining: document.querySelectorAll('[role="dialog"]:not([hidden])').length,
    listElapsedMs: Date.now() - window.__listOpenedAt,
    actions: __actions, waits: __waits, retryAt: __retryAt }));
  result.wallMs = Date.now() - started;
  await page.close();
  return result;
}
try {
  const timingOnly = process.argv.includes('--timing-only');
  const regressionOnly = process.argv.includes('--dialog-regressions');
  for (const options of timingOnly ? [] : [
    { name: 'all 114 following rows including absolute and native profile links', size: 114, mixedLinks: true },
    { name: 'all 114 including six links with separate usernames and display names', size: 114, splitAccountLabels: true },
    { name: 'same-profile following and followers URLs keep the scan active', size: 114, listRoute: true },
    { name: 'hidden duplicate controls and counts cannot supply the totals', size: 114, hiddenControls: true },
    { name: 'hidden closed dialogs are skipped when opening the next list', size: 114, hideDialog: true },
    { name: 'a competing visible dialog cannot be mistaken for the requested list', size: 114, competingDialog: true },
    { name: 'a non-div scroll container with incremental account rows', size: 300, semanticScroller: true },
    { name: 'a programmatically scrollable container with hidden overflow', size: 300, hiddenScroller: true },
    { name: 'an inner overflow wrapper with no scroll range uses the outer viewport', size: 300, nestedScroller: true },
    { name: 'post links, hidden links and suggestions do not count as list members', size: 24, outsideLinks: true },
    { name: '111 of 114 following rows need a fresh arrival at the end', size: 114, followingEnd: 'reenter' },
    { name: '108 of 114 need to leave the pagination preload zone before retrying', size: 114, followingEnd: 'deepReenter' },
    { name: 'six accounts reusing one plain link in a frame are all captured', size: 114, followingEnd: 'rapidRecycle' },
    { name: 'duplicate server entries are reconciled by exact account searches', size: 114, reconcile: 'search' },
    { name: 'missing followers are verified by the native Remove action', size: 114, reconcile: 'search', reconcileList: 'followers' },
    { name: 'duplicate server entries are reconciled from visible follow relationships', size: 114, reconcile: 'reverse' },
    { name: 'each stalled batch can be rechecked after more rows arrive', size: 114, followingEnd: 'multiple' },
    { name: 'pending 60-second following batch needs no fresh scroll', size: 114, followingEnd: 'pending', followingDelay: 60000 },
    { name: 'unmounted area below the last captured row is crossed in overlapping steps', size: 114, followingEnd: 'spacer' },
    { name: 'an offscreen loading indicator does not prevent reaching the end', size: 114, followingEnd: 'footerLoader' },
    { name: 'a 60-second cooldown pauses pagination and preserves captured rows', size: 114, followingEnd: 'limited', cooldown: 60000 },
    { name: 'rate-limited opening retries after the cooldown', size: 114, cooldownOnOpen: 60000 },
    { name: 'rate-limited opening can recover an empty dialog', size: 114, cooldownOnOpen: 60000, emptyShell: true },
    { name: 'rate-limited followers dialog stuck loading can recover from zero rows', size: 114,
      cooldownOnOpen: 60000, limitedList: 'followers', emptyShell: true, busyShell: true },
    { name: '1000 cumulative', size: 1000 }, { name: '2000 cumulative', size: 2000 },
    { name: '10000 cumulative', size: 10000, batch: 250 },
    { name: '1000 virtual rows', size: 1000, mode: 'virtual' },
    { name: '10000 virtual rows', size: 10000, mode: 'virtual' },
    { name: '2000 recycled anchors', size: 2000, mode: 'recycled' },
    { name: 'slow virtual renderer', size: 200, mode: 'virtual', renderDelay: 1200 },
    { name: 'slow virtual rendering keeps overlap with the last captured row', size: 200, mode: 'virtual', renderDelay: 9000 },
    { name: '18-second delayed batches', size: 200, batch: 100, delay: 18000 },
    { name: 'container replacement', size: 1000, mode: 'replace-container' },
    { name: 'dialog replacement', size: 1000, replaceDialog: true },
    { name: 'dialog replacement after a render gap', size: 1000, replaceDialog: true, replacementGap: 1200 },
    { name: 'opening dialog placeholder replacement', size: 1000, openingPlaceholder: true, replacementGap: 1200 },
    { name: 'late follower scroll area with a connected loading shell', size: 300, lateScrollArea: true },
    { name: 'dialog ancestor wrapper replacement', size: 1000, replaceDialog: true, replaceWrapper: true, replacementGap: 1200 },
    { name: 'virtual dialog replacement midway through collection', size: 1000, mode: 'virtual', replaceAtScroll: 20, replacementGap: 1200 },
    { name: 'non-scrolling small lists', size: 2, mode: 'all' },
    { name: 'both lists empty', size: 0, mode: 'all' },
    { name: 'rounded label with exact title', size: 1000, rounded: true, exactTitle: true },
    { name: 'deactivated accounts retained: 110 rows with 108 displayed', size: 110, smallerTotal: 2 }
  ].filter(options => !regressionOnly || options.name.includes('dialog'))) {
    const result = await run(options);
    assert.equal(result.failed, undefined, `${options.name}: ${JSON.stringify(result)}`);
    assert.ok(result.done, `${options.name}: no completion`);
    assert.deepEqual(result.done.accounts, options.size === 0 ? [] : ['missing'], options.name);
    assert.deepEqual(result.done.validation.followers, { expected: options.size - (options.smallerTotal || 0), collected: options.size });
    if (options.mixedLinks || options.splitAccountLabels || options.outsideLinks) {
      const expected = options.mixedLinks || options.splitAccountLabels ? 114 : 25;
      assert.deepEqual(result.done.validation.following, { expected, collected: expected });
    }
    if (options.followingEnd) {
      assert.deepEqual(result.done.validation.following, { expected: 114, collected: 114 });
      const visits = { reenter: 2, deepReenter: 2, rapidRecycle: 1, multiple: 6, pending: 1, spacer: 1, footerLoader: 1, limited: 2 };
      assert.equal(result.followingEndVisits, visits[options.followingEnd]);
    }
    if (options.reconcile) {
      assert.deepEqual(result.done.validation.following, { expected: 114, collected: 114 });
      const searches = options.reconcile === 'search' ? ['account_00020', 'account_00021', 'account_00022'] : [];
      assert.deepEqual(result.searches.map(search => search.value), searches);
      assert.ok(result.searches.every(search => search.list === (options.reconcileList || 'following')));
      for (let i = 1; i < result.searches.length; i++) assert.ok(result.searches[i].at - result.searches[i - 1].at >= 1500);
    }
    if (options.cooldown || options.cooldownOnOpen) {
      const pauseStarted = result.retryAt - (options.cooldown || options.cooldownOnOpen);
      const retries = result.actions.filter(action => action.list === (options.limitedList || 'following') && action.at > pauseStarted);
      assert.ok(retries.length && retries.every(action => action.at >= result.retryAt), options.name);
      if (options.busyShell) {
        const opens = result.actions.filter(action => action.list === options.limitedList && action.type === 'open');
        assert.equal(opens.length, 2);
        assert.ok(opens[1].at >= result.retryAt + 45000);
      }
    }
    if (options.followingEnd === 'spacer') {
      const steps = result.actions.filter(action => action.list === 'following' && action.type === 'scroll');
      assert.ok(steps.length > 2, 'cross the unmounted area without jumping to the bottom');
    }
    assert.equal(result.done.validation.verified, true);
    assert.equal(result.done.validation.settled, true);
    assert.equal(result.dialogsRemaining, 0, `${options.name}: list left open`);
    for (const list of ['following', 'followers']) {
      const actions = result.actions.filter(action => action.list === list);
      const scrolls = actions.filter(action => action.type === 'scroll');
      if (!scrolls.length) continue;
      assert.ok(scrolls[0].at - actions[0].at >= 5000, `${options.name}: initial wait was shortened`);
      for (let i = 1; i < scrolls.length; i++) assert.ok(scrolls[i].at - scrolls[i - 1].at >= 1500,
        `${options.name}: scroll cadence was shortened`);
      assert.ok(actions.at(-1).at - scrolls.at(-1).at >= 1500, `${options.name}: final scroll wait was shortened`);
    }
    const followingClose = result.actions.find(action => action.type === 'close' && action.list === 'following');
    const followersOpen = result.actions.find(action => action.type === 'open' && action.list === 'followers');
    if (followingClose && followersOpen) assert.ok(followersOpen.at - followingClose.at >= 4000,
      `${options.name}: close/between-list delays were shortened`);
    records.push({ name: options.name, status: 'verified', scrolls: result.scrolls, wallMs: result.wallMs });
    console.log('PASS:', options.name);
  }
  for (const options of timingOnly ? [] : [
    { name: 'stalled list', size: 1000, mode: 'stall', reason: 'incomplete_scan' },
    { name: '111 of 114 following rows remain incomplete after one recheck', size: 114, followingEnd: 'stall', reason: 'incomplete_scan' },
    { name: 'an exact search suggestion without a following relationship is not accepted', size: 114,
      reconcile: 'invalid', reason: 'incomplete_scan' },
    { name: 'cooldown beyond the list deadline reports the rate limit', size: 114, followingEnd: 'limited', cooldown: 3600000, reason: 'rate_limited' },
    { name: 'busy follower list remains at 0 of 114 after the allowed recovery', size: 114,
      cooldownOnOpen: 60000, limitedList: 'followers', emptyShell: true, busyShell: true, staysEmpty: true, reason: 'incomplete_scan' },
    { name: 'unverifiable rounded total', size: 1000, rounded: true, reason: 'unverified_count' },
    { name: 'profile changes during scan', size: 1000, changedCount: true, reason: 'incomplete_scan' },
    { name: 'list closes during loading', size: 1000, delay: 18000, closeDuringLoad: true, reason: 'interrupted' },
    { name: 'dialog does not return within recovery limit', size: 1000, replaceDialog: true, replaceAfter: 6000, replacementGap: 4000, reason: 'interrupted' },
    { name: 'repeated dialog replacements without progress', size: 1000, mode: 'stall', replaceDialog: true, replaceAfter: 6000, replacementInterval: 1800, replaceTimes: 6, reason: 'interrupted' },
    { name: 'hard deadline', size: 1000, jumpClock: true, reason: 'incomplete_scan' }
  ]) {
    const result = await run(options);
    assert.equal(result.done, undefined, `${options.name}: published incomplete results`);
    assert.equal(result.failed?.reason, options.reason, `${options.name}: ${JSON.stringify(result)}`);
    assert.equal(result.resultsPresent, false);
    assert.equal(result.comparisonCreated, false, `${options.name}: comparison was constructed before verification`);
    if (options.followingEnd === 'stall') {
      assert.equal(result.failed.message, 'F4F Checker verified 111 of 114 accounts you follow. No comparison was made.');
      assert.equal(result.followingEndVisits, 2);
      assert.equal(result.actions.filter(action => action.list === 'following' && action.type === 'scroll').length, 3);
      const firstClose = result.actions.find(action => action.list === 'following' && action.type === 'close');
      assert.ok(firstClose.at - result.actions[0].at <= 114000, 'the stalled following scan exceeded the wait budget');
    }
    if (options.reconcile === 'invalid') {
      assert.match(result.failed.message, /verified 113 of 114 accounts you follow/);
      assert.ok(result.searches.some(search => search.value === 'account_00021'));
    }
    if (options.cooldown) {
      assert.equal(result.followingEndVisits, 1);
      assert.match(result.failed.message, /Retry after/);
    }
    if (options.staysEmpty) {
      assert.equal(result.clicks.filter(click => click === 'open:followers').length, 2);
      assert.match(result.failed.message, /verified 0 of 114 followers/);
    }
    if (options.replaceDialog || options.closeDuringLoad) assert.ok(result.listElapsedMs <= 20000, `${options.name}: interruption was not bounded`);
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
    if (process.argv.includes('--real-timing')) {
      assert.deepEqual(safer.waits, original.waits, 'baseline healthy timer sequence must be restored exactly');
      assert.ok(safer.wallMs >= 48900, 'baseline healthy run must not finish early');
    }
    records.push({ name: `unshortened healthy timing (${options.size} followers)`, originalMs: original.wallMs, validatedMs: safer.wallMs });
    console.log(`PASS: real timers; original ${original.wallMs}ms, validated ${safer.wallMs}ms; identical accounts.`);
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(process.argv.includes('--real-large') ? 'artifacts/collector-large-timing.json' :
    'artifacts/collector-verification.json', JSON.stringify(records, null, 2));
  console.log('Collector checks passed:', records.length, '(local fixtures; live Instagram loading is not simulated exactly).');
} finally { await browser.close(); }
