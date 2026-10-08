# Immutable checker baseline

Original input: `f4fchecker.js` (5,818 bytes). SHA-256:
`6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23`.

No runtime dependencies. It is a self-executing async browser script using DOM,
Set, promises, timers, console and alert. Its profile username comes from the
current pathname, with slashes removed.

## Exact behavior preserved

This section describes the standalone source and reference `checker-runner.js`.
The current extension uses `safe-runner.js` with the explicitly requested
collection safeguards below; its scrolling and timing are intentionally changed.

- `openList(type)` finds an anchor whose href equals `/${username}/${type}/`,
  clicks it, then waits 3,000 ms.
- `scrollAndCollect()` checks `div[role="dialog"]` up to 30 times, 500 ms apart;
  waits 2,000 ms; chooses the overflowing descendant div with greatest
  scrollHeight; moves to its bottom, waits 1,500 ms per pass; collects
  `a[role="link"][href^="/"]`; extracts the first path component before `?`;
  excludes only `explore` and `reels`. It retains Set insertion order.
- It stops after eight stable-height passes with at least three consecutive
  no-new-user passes. No timeout, pagination API or alternative scraper is added.
- `closeModal()` uses its original ordered selectors (English Close, Turkish
  Kapat, then css-img), button/parent click, parent backdrop fallback and 2,000 ms wait.
- Execution collects following, closes, waits 2,000 ms, collects followers,
  closes, then computes followingSet minus followersSet, case-sensitive and
  insertion-ordered. There is one result category: not following back.
- Output includes category count, original following/follower list lengths,
  ordered username links, a close action and target-blank profile actions.
  There are no filters, sort controls, exports or other categories in the input.
- Original errors are logged and alerted in Turkish.

## Reference integration boundary

The build embeds the entire original file as an unchanged byte sequence in
`extension/checker-runner.js`. A lexical `document` proxy delegates to the real
document and adds localized Close lookup **only when the original selector
fails**. The separate `list-controls.js` interface adapter also extends the
original top-level `querySelectorAll('a')` lookup when an exact list href is absent:
it recognizes equivalent absolute/slashless hrefs or the visible labelled native
button/span and exposes its canonical list href to `openList`. The wrapper's
click remains bound to the actual Instagram element (label clicks bubble to the
site's enclosing handler). It leaves exact original links first and unchanged.
No HTML anchors are inserted and no global DOM APIs are replaced. Crucially,
`dialog.querySelectorAll(...)`, scrolling, stability tests, sleeps, Set comparison
and original output are untouched. This changes interface recognition only.
The lexical alert adapter records the original error in the extension instead
of opening a blocking alert. These are UI integrations, not algorithm changes.

The adapter awaits the original IIFE, detects an original error, then requires
the original results box before publishing completion. It reads the generated
output, restyles the original box, and retains its close/profile actions. No
parallel comparison is used to generate production results. SHA verification,
verbatim runner checks and differential full-script fixtures guard integrity.

The baseline's limitations (including possible incomplete DOM lists, no hard
timeout for continuously changing lists, and case-sensitive comparisons) are
preserved intentionally. Navigation/readiness timeouts are outside the checker.

## Validated collection used by version 1.0.4

The user's subsequent request explicitly authorized completion validation,
safer collection and adaptive waits/bounded retries. These collection changes
live in `collector.js`. The build generates a separate `safe-runner.js` from the
immutable source by replacing only the openList, scrollAndCollect and closeModal
delegates. The original comparison, result generation, labels, category and
two-second between-list wait remain verbatim. The production worker injects
collector/adapter/safe-runner; the old runner remains a reference.

The collector reads exact following/follower counts from the recognized native
controls. It accepts unambiguous localized integers and grouped thousands,
including Arabic/Persian/fullwidth digits. Rounded values such as 10K/1.2M are
not exact; an exact title or accessibility value may provide the integer.
Missing or contradictory exact counts prevent verified completion.

Each list starts by capturing mounted rows before scrolling. A single observer
collects added/removed nodes and href changes, preserving recycled anchors' old
and new values. Collection retains the original href extraction, reserved-name
exclusions, case sensitivity and Set insertion order. A cached last mounted
anchor bounds safe scrolling, so an unseen virtual gap is not skipped and no
full-list query is repeated on each scroll. Replaced scroll containers are
recognized and scanned once. Already captured mounted rows can be crossed in
one step; virtual windows retain viewport overlap.

Healthy traversal uses a 200 ms cadence. Stalled loading/rendering gets waits
of 1.5, 3, 6 and 10 seconds, woken early by new accounts or loading progress.
Actual new accounts reset the retry budget. Four quiet waits fail the list;
each list also has a 20-minute deadline even if content keeps changing.
Dialog opening is bounded at 15 seconds and closing at 2.5 seconds. Empty lists
skip opening; short non-scrolling lists are accepted when counts match.

Both collected totals must match the exact initial counts, and the profile
totals are read again before publication. The adapter and worker require
verified evidence before completion. A collection/validation failure publishes no non-followers and
removes a prematurely generated result box. Owned observers/dialogs are cleaned
up. Counts are a consistency check, not an atomic snapshot guarantee: list
membership can change without changing totals during sequential collection.

On the healthy 10,000-follower cumulative fixture, actual unshortened timers
measured 106,383 ms for the reference and 9,958 ms for validated collection.
Full totals and result accounts matched, including followed accounts appearing
in the first, middle and final follower batches. This is fixture evidence;
Instagram's live loading delays and DOM behavior still determine actual times.

## Original reference timing audit

`npm run test:timing` executes the original on anchors and the packaged adapter
on native buttons concurrently in isolated browser fixtures, with actual timers
and no clock acceleration. On the two-account lists used in that fixture, the
latest measured executions were 49,186 ms and 49,085 ms respectively. Each used
two 3,000 ms opening waits, five 2,000 ms setup/close/between-list waits and
twenty-two 1,500 ms scrolling waits. Both lists reached stability 8/8; requested
wait sequences, click order, collected output and stability logs matched exactly.
Twenty-two scrolling passes is a fixture result, not a fixed production count.
The original loop always waits for eight stable passes after its no-new-user
condition, and can run longer as new accounts arrive. Its missing-dialog retry
limit is still the exact original 30 attempts with a 500 ms wait per failed attempt.
