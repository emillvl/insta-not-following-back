import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { collectorFixture } from './collector-fixture.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true });
const records = [];
const extensionPath = process.env.F4F_TEST_EXTENSION || 'extension';
const scaleAudit = process.argv.includes('--scale-audit');
async function run(options, baseline = false, real = false) {
  const page = await browser.newPage();
  if (!real) { await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000)); }
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: collectorFixture(options) }));
  await page.goto('https://www.instagram.com/me/');
  const perf = scaleAudit ? await page.context().newCDPSession(page) : null;
  const performanceMetrics = async () => Object.fromEntries((await perf.send('Performance.getMetrics')).metrics
    .map(({ name, value }) => [name, value]));
  let before, heapSample;
  if (perf) {
    await perf.send('Performance.enable');
    await perf.send('HeapProfiler.collectGarbage');
    before = await performanceMetrics();
    heapSample = before.JSHeapUsedSize;
  }
  const started = Date.now();
  if (baseline) {
    void page.evaluate(readFileSync('f4fchecker.js', 'utf8')).catch(() => {});
  } else {
    for (const file of ['localization.js', 'list-controls.js', 'collector.js', 'adapter.js', 'safe-runner.js']) {
      await page.addScriptTag({ content: readFileSync(join(extensionPath, file), 'utf8') });
      if (file === 'collector.js' && (options.followingEnd === 'deepReenter' || options.reconcile)) {
        await page.evaluate(() => {
          window.__collected = [];
          const collect = F4FCollector.collect;
          F4FCollector.collect = async () => {
            const names = await collect();
            __collected.push(names);
            return names;
          };
        });
      }
    }
  }
  if (!real) {
    for (let i = 0; i < 2000; i++) {
      if (await page.evaluate(() => Boolean(window.__done || window.__failed || __alerts.length))) break;
      await page.clock.runFor(1000);
      if (perf && i % 25 === 0) heapSample = Math.max(heapSample, (await performanceMetrics()).JSHeapUsedSize);
    }
  } else await page.waitForFunction(() => Boolean(window.__done || window.__failed || document.getElementById('closeF4FBox')), null, { timeout: 180000 });
  const result = await page.evaluate(() => ({ done: window.__done, failed: window.__failed,
    alerts: __alerts, scrolls: __scrolls, clicks: __clicks, progress: __progress,
    originalAccounts: [...document.querySelectorAll('#closeF4FBox + h3 + div + ul li a')].map(a => a.textContent),
    originalSummary: document.getElementById('closeF4FBox')?.parentElement.querySelector('div').textContent.trim(),
    resultsPresent: Boolean(document.getElementById('closeF4FBox')),
    followingEndVisits: __followingEndVisits, comparisonCreated: __comparisonCreated,
    searches: __searches,
    verificationLeftOpen: document.documentElement.hasAttribute('data-f4f-verifying') ||
      Boolean(document.querySelector('[role="dialog"][inert]')),
    dialogsRemaining: document.querySelectorAll('[role="dialog"]:not([hidden])').length,
    elapsedMs: Date.now() - __actions[0]?.at,
    listElapsedMs: Date.now() - window.__listOpenedAt,
    actions: __actions, waits: __waits, retryAt: __retryAt, collected: window.__collected,
    expected: window.__collected && Object.values(__expectedLists) }));
  result.wallMs = Date.now() - started;
  if (perf) {
    const after = await performanceMetrics();
    await perf.send('HeapProfiler.collectGarbage');
    const retained = await performanceMetrics();
    result.performance = { scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
      layouts: after.LayoutCount - before.LayoutCount,
      sampledHeapMiB: Math.max(heapSample, after.JSHeapUsedSize) / 2 ** 20,
      retainedHeapMiB: retained.JSHeapUsedSize / 2 ** 20 };
  }
  await page.close();
  return result;
}
try {
  const timingOnly = scaleAudit || process.argv.includes('--timing-only');
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
    { name: 'duplicate server entries are reconciled by exact account searches', size: 114, reconcile: 'search', caseVariants: true },
    { name: 'missing followers are verified in the already open dialog', size: 114, reconcile: 'search', reconcileList: 'followers' },
    { name: 'duplicate server entries are reconciled from visible follow relationships', size: 114, reconcile: 'reverse' },
    { name: 'an explicit Follows you label verifies missing followers without searching', size: 114,
      reconcile: 'reverse', reconcileList: 'followers' },
    { name: 'checks skip Follow Back and deactivated accounts while recovering active entries', size: 114, reconcile: 'targeted' },
    { name: 'exact searches wait for a visible loader before typing the next name', size: 114, reconcile: 'search', searchDelay: 11000 },
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
    assert.equal(result.verificationLeftOpen, false);
    const followerTotal = options.size + (options.reconcile === 'targeted' ? 2 : 0);
    assert.deepEqual(result.done.validation.followers, { expected: followerTotal - (options.smallerTotal || 0), collected: followerTotal });
    if (options.mixedLinks || options.splitAccountLabels || options.outsideLinks) {
      const expected = options.mixedLinks || options.splitAccountLabels ? 114 : 25;
      assert.deepEqual(result.done.validation.following, { expected, collected: expected });
    }
    if (options.followingEnd) {
      assert.deepEqual(result.done.validation.following, { expected: 114, collected: 114 });
      const visits = { reenter: 2, deepReenter: 2, rapidRecycle: 1, multiple: 6, pending: 1, spacer: 1, footerLoader: 1, limited: 2 };
      assert.equal(result.followingEndVisits, visits[options.followingEnd]);
    }
    if (result.collected) {
      assert.deepEqual(result.collected.map(names => [...names].sort()), result.expected.map(names => [...names].sort()));
    }
    if (options.reconcile) {
      assert.deepEqual(result.done.validation.following, { expected: 114, collected: 114 });
      const searches = options.reconcile === 'reverse' ? [] : ['account_00020', 'account_00021', 'account_00022'];
      if (options.reconcile === 'targeted') searches.shift();
      assert.deepEqual(result.searches.map(search => search.value), searches);
      assert.ok(result.searches.every(search => search.list === (options.reconcileList || 'following')));
      for (let i = 1; i < result.searches.length; i++) {
        assert.ok(result.searches[i].at - result.searches[i - 1].at >= (options.searchDelay || 1500));
      }
      if (!options.searchDelay) assert.ok(result.elapsedMs <= 70000, `recovery took ${result.elapsedMs} ms`);
      if (options.reconcileList === 'followers') assert.equal(result.clicks.filter(click => click === 'open:followers').length, 1);
    }
    if (options.cooldown || options.cooldownOnOpen) {
      const pauseStarted = result.retryAt - (options.cooldown || options.cooldownOnOpen);
      const retries = result.actions.filter(action => action.list === (options.limitedList || 'following') && action.at > pauseStarted);
      assert.ok(retries.length && retries.every(action => action.at >= result.retryAt), options.name);
      if (options.busyShell) {
        const opens = result.actions.filter(action => action.list === options.limitedList && action.type === 'open');
        assert.equal(opens.length, 2);
        assert.ok(opens[1].at <= result.retryAt + 5000, 'replay the rejected opening once after expiry');
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
    records.push({ name: options.name, status: 'verified', scrolls: result.scrolls, elapsedMs: result.elapsedMs, wallMs: result.wallMs });
    console.log('PASS:', options.name);
  }
  for (const options of timingOnly ? [] : [
    { name: 'stalled list', size: 1000, mode: 'stall', reason: 'incomplete_scan' },
    { name: '111 of 114 following rows remain incomplete after one recheck', size: 114, followingEnd: 'stall', reason: 'incomplete_scan' },
    { name: 'an exact search suggestion without a following relationship is not accepted', size: 114,
      reconcile: 'invalid', reason: 'incomplete_scan' },
    { name: 'conflicting relationship labels on exact search matches stay incomplete', size: 114,
      reconcile: 'ambiguous', reason: 'incomplete_scan' },
    { name: 'a deactivated candidate is never searched for a missing Following entry', size: 114,
      reconcile: 'inactive', reason: 'incomplete_scan' },
    { name: 'deactivated candidates are never searched for a missing Followers entry', size: 114,
      reconcile: 'inactive', reconcileList: 'followers', reason: 'incomplete_scan' },
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
    assert.equal(result.verificationLeftOpen, false);
    if (options.followingEnd === 'stall') {
      assert.equal(result.failed.message, 'F4F Checker verified 111 of 114 accounts you follow. No comparison was made.');
      assert.equal(result.followingEndVisits, 2);
      assert.equal(result.actions.filter(action => action.list === 'following' && action.type === 'scroll').length, 3);
      const firstClose = result.actions.find(action => action.list === 'following' && action.type === 'close');
      const elapsed = firstClose.at - result.actions[0].at;
      assert.ok(elapsed <= 30000, `the settled following scan took ${elapsed} ms`);
    }
    if (['invalid', 'ambiguous'].includes(options.reconcile)) {
      assert.match(result.failed.message, /verified 113 of 114 accounts you follow/);
      assert.ok(result.searches.some(search => search.value === 'account_00021'));
    }
    if (options.reconcile === 'inactive') {
      const list = options.reconcileList === 'followers' ? 'followers' : 'accounts you follow';
      assert.equal(result.failed.message, `F4F Checker verified 113 of 114 ${list}. No comparison was made.`);
      assert.deepEqual(result.searches, []);
      assert.equal(result.clicks.filter(click => click.startsWith('open:')).length, 2);
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
      assert.ok(safer.wallMs >= 45000 && safer.wallMs <= original.wallMs + 1000,
        'small healthy scans should stay close to the baseline cadence');
    }
    records.push({ name: `unshortened healthy timing (${options.size} followers)`, originalMs: original.wallMs, validatedMs: safer.wallMs });
    console.log(`PASS: real timers; original ${original.wallMs}ms, validated ${safer.wallMs}ms; identical accounts.`);
  }
  if (scaleAudit) {
    for (const options of [
      { name: 'cumulative 10,000 per list with row buttons', size: 10000, batch: 250, largeFollowing: true },
      { name: 'virtual 10,000 followers', size: 10000, mode: 'virtual' }
    ]) {
      const result = await run(options);
      assert.deepEqual(result.done?.accounts, ['missing'], JSON.stringify(result.failed));
      assert.equal(result.done.validation.followers.collected, 10000);
      if (options.largeFollowing) assert.equal(result.done.validation.following.collected, 10000);
      records.push({ name: options.name, wallMs: result.wallMs, progressMessages: result.progress.length, ...result.performance });
    }
    console.log(JSON.stringify(records, null, 2));
  }
  mkdirSync('artifacts', { recursive: true });
  const report = scaleAudit ? 'collector-scale' : process.argv.includes('--real-large') ? 'collector-large-timing' : 'collector-verification';
  writeFileSync(`artifacts/${report}.json`, JSON.stringify(records, null, 2));
  console.log('Collector checks passed:', records.length, '(local fixtures; live Instagram loading is not simulated exactly).');
} finally { await browser.close(); }
