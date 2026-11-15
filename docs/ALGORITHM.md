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
scroll cadence, 2,000 ms closing wait, and eight stable passes. Arriving data never
shortens these waits. It captures mounted rows before scrolling and observes
added, removed, and recycled rows, including old href values. Account links
resolve to Instagram profile URLs. Plain links need an account-name label that
matches the destination, including an exact username in a nested element. The
collector retains case and insertion order.

A cached last row guides scrolling through captured coverage. When the target
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
value. Profile totals are read again before comparison. When the list settles
before the scan can be verified or loading stalls above the end, the collector
checks for progress for up to 90 seconds. After 45 seconds without a loader it
can rewind and rescan from the top, or reopen a short list that has no usable scroll range.
New accounts reset the stall timer and allow another recheck on a later batch.

A short scan triggers one direct navigation to the current account’s list URL
in a temporary tab. The worker accepts the intended same-account route or a
redirect back to the verified profile. The collector reads the list dialog or
the labelled list page, then returns the names from a settled scan. The original
page adds names it had missed and checks the combined total. The worker closes
the temporary tab and discards responses from other tabs or accounts.

The worker observes first-party HTTP 429 responses in the top frame of the
scanning tab. It honors `Retry-After` as seconds or an HTTP date and uses one-,
two- and four-minute waits when no usable header is present. During the wait,
the collector keeps observing rows and pauses list opening and scrolling. The
banner shows the next attempt time. Once it elapses, a short list stays in
Waiting for Instagram until the collected count grows. An empty dialog that
still shows a loader can be reopened once after 45 more seconds of settled
inactivity. Each list has a 20-minute deadline. If the requested cooldown
exceeds the available time, the scan ends with a retry time. Empty lists skip
opening, and short lists can settle without scrolling.

The adapter requires the original result box and the collector's verified,
settled evidence. The worker checks that evidence before saving results.
A failed scan publishes no non-followers. A storage quota error retains the
verified on-page result. Owned observers and dialogs are cleaned up after a run.

Counts and settling cannot establish an atomic snapshot. Membership can change
without changing totals, and displayed counts cannot prove that every deactivated
account was exposed.

## Timing

The current healthy two-account fixture uses the exact original wait sequence:
two 3,000 ms waits, five 2,000 ms waits, and twenty-two 1,500 ms waits. Measured
times were 49,123 ms for the original and 49,130 ms for the collector, with
identical accounts and summary. The number of scroll passes depends on loading.
These fixture measurements do not predict live Instagram completion times.
