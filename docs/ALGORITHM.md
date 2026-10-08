# Immutable checker baseline

Original input: `f4fchecker.js` (5,818 bytes). SHA-256:
`6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23`.

No runtime dependencies. It is a self-executing async browser script using DOM,
Set, promises, timers, console and alert. Its profile username comes from the
current pathname, with slashes removed.

## Exact behavior preserved

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

## Integration boundary

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

## Original timing audit

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
