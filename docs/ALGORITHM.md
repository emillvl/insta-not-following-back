# Checker and collection

## Original script

`f4fchecker.js` is 5,818 bytes. Its SHA-256 is
`6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23`.

The original script:

- Gets the username from the current pathname.
- Clicks the exact `/<username>/following/` link and waits 3,000 ms.
- Finds a dialog with up to thirty 500 ms checks, waits 2,000 ms, and chooses
  the overflowing descendant with the greatest scroll height.
- Scrolls to the bottom and waits 1,500 ms per pass. It collects
  `a[role="link"][href^="/"]`, takes the first path component before `?`,
  and excludes `explore` and `reels`.
- Finishes after eight stable-height passes with at least three consecutive
  passes containing no new accounts.
- Closes the dialog, waits 2,000 ms, and waits another 2,000 ms before opening
  followers. It repeats collection and closure.
- Computes following minus followers with case-sensitive Sets and insertion order.
- Shows one category, its count, actual list totals, and profile links. Labels
  and errors are Turkish.

The original file is unchanged. The baseline commit normalized CRLF because of
Git's line-ending configuration. The committed file was restored to its supplied
CRLF bytes; `.gitattributes` preserves the source and runners.

## Extension

The worker selects an Instagram tab, brings it to the foreground, and asks
`content.js` to open the native Profile control. The own page's Edit profile
control or recognized navigation link confirms ownership. Readiness waits up to
sixty seconds through login and profile navigation. Paths and cached usernames
alone do not establish ownership.

`list-controls.js` accepts exact original links first, then equivalent
absolute/slashless links and labelled native controls or nested count spans.
It reads visible controls and ignores hidden duplicate counts. Clicks use
Instagram's existing handlers. Close labels support English, Turkish,
Spanish, French, German, Italian, Portuguese, Russian, Arabic, Japanese, and
Korean. Supported labels have fixture coverage; live translations can change.

`checker-runner.js` embeds the original script. Its document adapter extends
only interface recognition. `safe-runner.js` delegates list opening, collection,
and closure to `collector.js`; the original comparison, output, and between-list
wait remain verbatim. The worker injects the production runner into Chrome's
isolated content-script world.

The collector uses the original 3,000 ms opening wait, 2,000 ms setup, 1,500 ms
scroll cadence, and 2,000 ms closing wait. It uses seven stable passes for a
verified end and eight before considering a short-list recovery. It captures
mounted rows before scrolling and observes added, removed, and recycled rows,
including old href values. Account links
resolve to Instagram profile URLs. Plain links need an account-name label that
matches the destination, including an exact username in a nested element. The
collector treats usernames case-insensitively and retains insertion order.

A cached last row guides scrolling through captured coverage. The collector
sends progress on count changes and reads relationship controls when they mount
or change. When the target
stops advancing, the collector waits for rendering, moves to the edge of the
captured rows, and uses overlapping viewport steps to cross any remaining gap.
The collector chooses a container that holds account rows and has a scroll
range. It uses declared scrolling containers for small lists that already fit.
It reads mutations within the selected container and reacquires replaced ones.
Hidden dialogs are treated as closed. Missing dialogs get three
seconds to return at a paced check and up to four consecutive observed
replacements without new accounts.
Completion requires reaching the end, settled height and membership, no visible
loading indicator, and collected totals at least as large as displayed counts.
Deactivated rows are retained above those totals.

Exact counts accept localized integers and grouped thousands, including Arabic,
Persian, and fullwidth digits. Rounded values require an exact title or accessible
value. Profile totals are read again before comparison. When a list settles
short of its total, the collector can rewind to retrigger pagination in the
original tab. It waits three paced passes at the settled end after that recheck.
New rows allow another recheck for a later batch. A visible loader pauses
scrolling. A stall with visible loading or above the end gets up to 90 seconds
after the initial stable passes. An empty dialog may be replayed once when its
opening received HTTP 429 with a usable retry time.

If the list has settled with fewer unique accounts than the profile count,
the collector retains it and reads the other list. A Following action on a
specific Followers row verifies an outgoing follow. Follow, Follow Back, and
Requested rule out a current outgoing follow. A Follows you label on a Following
row verifies an incoming follow. If a
shortfall remains, the collector searches eligible usernames from the opposite
list and skips rows marked deactivated. It hides the list dialog visually and
focuses the native search field. If the field remounts while a result loads,
the collector waits for the exact query to reappear. A search result must match
the username and expose an affirmative relationship for the list being checked.
The collector can verify missing followers in the already open list.

A scan allows four exact search inputs, including any replay. The collector
tries candidates while enough inputs remain to cover both shortfalls. It spaces
inputs at least 1,500 ms apart and waits for visible search loaders before
sending the next name. Both totals are checked again before comparison.

The worker observes first-party XHR and fetch requests to the observed
`/api/v1/friendships/<id>/following/` and `followers/` routes. The request must
begin in the active scan's top-frame document. The worker tracks pending
request IDs in session storage, including across worker restarts. A request's
route identifies its list. A cursor or query parameter identifies pagination
or search when present. [Chrome webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest)

The first HTTP 429 stops the scan if there is no usable future `Retry-After`.
Delay seconds and HTTP dates are accepted. [HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)

Both lists and reconciliation
share a 20-minute collection deadline. If a server wait fits, the worker
allows one automatic retry after the latest deadline from the in-flight
responses. The collector can continue reading mounted rows while list
opening, scrolling, rewinds, and search inputs are paused. After the retry,
another HTTP 429 stops collection. Long server waits end the check and keep
manual retry gated until expiry.

The popup and page show the rejection time, any deadline supplied by
Instagram, and the manual retry action when a check stops. At expiry they
update even if zero accounts arrived. Duplicate Start calls return to the
active check. A full reload or tab closure stops collection and preserves an
outstanding server wait. Empty lists skip opening.

The adapter requires the original result box and the collector's verified,
settled evidence. The worker checks that evidence before saving results.
A failed scan publishes no non-followers. A storage quota error retains the
verified on-page result. Owned observers and dialogs are cleaned up after a run.

Counts and settling cannot establish an atomic snapshot. Membership can change
without changing totals, and displayed counts cannot prove that every deactivated
account was exposed.

## Timing

The healthy two-account collector fixture keeps the opening, closing, and
scroll cadence and spends one fewer quiet pass per list. That run took about
46 seconds. See [Verification](VERIFICATION.md) for Chrome request counts,
elapsed times, and the earlier build results.
