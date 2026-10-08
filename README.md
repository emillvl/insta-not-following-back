# F4F Checker for Chrome

A Manifest V3 extension around the supplied F4F Checker browser script. The
original checking file remains **byte-for-byte unchanged**. No server, API
scraper, remote executable code, analytics or runtime dependencies are used.
Version 1.0.6 restores the original interaction delays and settling checks while
keeping safer collection and completion validation. The original Set comparison
and result construction are retained verbatim.

## Load and use

1. Open `chrome://extensions` in Chrome 112 or newer.
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's
   **extension** folder (the folder containing `manifest.json`, not the root).
3. Pin F4F Checker if desired. Open it from any tab and select **Start Checking**.
4. Instagram is brought to the foreground. If already logged in, the extension
   uses Instagram's native **Profile** control to open your own profile and starts
   automatically. If logged out, sign in on Instagram; checking continues after
   login. There is no username entry in the extension. If you are already on your
   own profile, its **Edit profile** control confirms that the checker can start.
5. Keep Instagram open and active until checking finishes. Closing the popup
   does not stop checking. Switching tabs may delay or interrupt it.
6. Read the result box on Instagram, or reopen the extension and select
   **View Results**. Profile links open in new tabs, just as in the original.

The results retain the original Turkish field labels, list order, category
count and following/follower totals. An empty list is a successful original
result with count zero, not an error. Check Again runs the validated collector
again. Reloading/navigating away from the checking page or closing that tab
reports interruption; the extension does not silently restart it.

Choose **Appearance** in the popup: **System** (the default) follows your computer's
preferred light/dark mode and updates automatically when it changes; **Light**
keeps the current white theme; **Dark** uses Instagram-style dark surfaces.
The choice applies to the popup, results and status banner. It is saved locally
across browser sessions and extension updates, separately from checking results.

After updating the unpacked extension to **1.0.6**, click its Reload button on
`chrome://extensions`, refresh the Instagram page, then select Start Checking.
Refreshing replaces the previous content script and its stalled wait state.

## Complete and incomplete scans

The checker captures rows before scrolling and observes new, removed and recycled
rows as Instagram renders them. It moves only through already captured rows,
waiting for further rendering before advancing into an unseen section. The
original pacing is restored: three seconds after opening a list, two seconds
before collection, 1.5 seconds per scroll pass, two seconds after closing, and
the existing two-second pause between lists. Arriving rows never shorten these
delays. Scans wait for the original eight stable-height passes after three
consecutive passes with no new accounts, including when the displayed count
has already been reached. Back-and-forth scroll nudges are removed.

Loading that remains incomplete after settling gets additional quiet waits of
3, 6 and 10 seconds. New accounts reset the retry budget. Each list has a
20-minute hard deadline; dialog discovery and closure remain separately bounded.

When Instagram replaces a dialog or its wrapper while rendering, collection
keeps the accounts already captured and reattaches to the replacement. A missing
dialog gets up to three seconds to return at the next paced check; four
consecutive observed replacements without new accounts are allowed.
An actual closure, repeated replacements without progress, navigation or the
list deadline still stop checking without publishing an incomplete result.

Completion requires the full settling checks and collected following/follower
totals at least as large as the exact displayed counts, with profile totals
checked again at the end. Displayed totals can omit deactivated accounts; those
accounts stay in the collection, and exceeding the displayed total is accepted
after settling. Rounded labels such as
`10K` are never treated as exact; an exact title/accessibility value can supply
the real number. Missing exact counts, changed totals, stalls, closed lists and
deadline failures produce a retryable error without publishing non-followers.
Real collected counts appear in the popup while checking, without invented
percentages. Counts and settling are consistency checks, not proof of an atomic
snapshot: memberships can still change while the two lists are read, and
displayed counts alone cannot prove that all deactivated accounts were exposed.

## Architecture and navigation

- `service-worker.js` serializes navigation and lifecycle events, activates the
  selected Instagram tab and focuses its browser window. It prefers the active
  Instagram tab, then an Instagram tab in the current window, then another
  existing Instagram tab; otherwise it creates one active Instagram tab.
- `content.js` runs only in Instagram's top frame. It clicks the visible native
  Profile control, including plain sidebar links, accessible SVG icons and
  buttons, without requiring a semantic nav wrapper or avatar. On an own-profile
  page, the native Edit profile route or label provides independent ownership
  evidence. It waits for the native following and follower controls recognized
  by the separate list-selector adapter, then requests a single run. The current pathname alone is never
  ownership evidence. Login is gated and resumes after normal authentication.
  Readiness keeps polling through SPA/manual profile navigation, with a 60-second
  deadline; it no longer stops at 15 seconds. These waits are outside the checker.
- `list-controls.js` keeps the exact original relative links first, accepts
  equivalent absolute/slashless list hrefs and binds labelled buttons, role
  controls or nested count spans to their actual native click target. It also
  recognizes exact localized integer counts, rejecting rounded/ambiguous totals.
- `collector.js` owns safer scrolling, mutation-based collection, baseline pacing,
  settling, bounded retries and count validation. One row observer and one
  outstanding wait serve each list. Dialog replacements are checked after the
  paced waits; row arrivals never wake them early. It caches the last mounted
  row to avoid repeated full-list
  queries while scrolling. Progress updates are limited to once per second,
  apart from list boundaries. Observers are disconnected and owned dialogs are
  closed on completion or failure.
- The worker claims the ready page, records **running**, then injects packaged
  `collector.js`, `adapter.js` and `safe-runner.js` into Chrome's default **isolated content
  script world**. They operate on the real Instagram DOM and click its controls;
  they need no Instagram JavaScript globals.
- `adapter.js` awaits execution, captures alerts as extension errors, and requires
  both the result box and verified collection evidence before completion.
  Injection and profile navigation never count as successful checking.
- `popup.html`, `popup.css` and `popup.js` show idle, navigating, waiting, running,
  completed and error states, including normal Instagram login recovery. They use
  indeterminate indicators, never fabricated percentages.
- `theme.js` shares light/dark color tokens across extension surfaces, listens
  for system appearance and local preference changes, and saves `appearance` in
  `chrome.storage.local`. Its page styles are scoped to the extension's results
  and shadow-root banner; Instagram's own appearance setting is unaffected.
- Operation state and original rendered output are held in `chrome.storage.session`.
  Reopening the popup or worker suspension does not erase them. Session data
  clears on browser restart, extension reload/update or disable. Results can be
  reopened even after the original results box or Instagram tab is closed.
  Nothing is synced or sent to a third-party server; Instagram still receives
  its normal page interactions. Credentials are neither read nor stored.
- Permissions are only `storage`, `scripting` and the two HTTPS Instagram host
  patterns. There is no `tabs`, `activeTab`, cookies, broad website-access or
  debugger permission. Chrome tab navigation and activation use extension APIs.

The implementation follows Chrome's [content-script model](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [session-storage model](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Original algorithm and diff review

[ALGORITHM.md](docs/ALGORITHM.md) records every original selector, delay, retry,
scroll loop, comparison and output field. The original SHA-256 is
`6b21281d11d84690d2bbf993b3ac3c0ba6c64cd38bfb4e5dc897443752ee9d23`.
The build embeds its entire byte sequence in `checker-runner.js`, retained as a
reference. It also generates `safe-runner.js`, delegating only list opening,
collection and closure to the new collector. The original comparison/output
tail remains byte-for-byte intact in both runners. The original source is still
usable standalone; the extension now injects the validated runner.

The baseline Git commit initially normalized CRLF to LF because Git's existing
configuration enabled automatic line-ending conversion. `.gitattributes` now
marks the original and runner as binary-preserved text; renormalization restored
the supplied CRLF bytes **in Git's index only**. The working original was never
edited. A raw baseline diff therefore shows line endings; the baseline diff
with `--ignore-space-at-eol` is empty. The committed original now has the exact
supplied SHA-256 and will retain it on future checkouts.

The collection/timing changes in 1.0.4 implement the user's explicit request for
safer collection, adaptive waits and validation. Earlier conversion versions
preserved all original scrolling and timing; the reference runner still does.
The current collector preserves username extraction, case sensitivity, the two
original reserved-name exclusions and Set insertion order. Comparison, category
and result fields are unchanged. Native DOM controls are still used throughout.
Version 1.0.6 restores the original interaction delays and settling checks. It
also accepts settled list totals above displayed counts so deactivated accounts
are retained; their extraction and comparison remain unchanged.

## Language recognition and design

Profile and list URLs remain independent of Instagram's language. English and
Turkish recognition remains available. The separate Close-label mapping also
handles Spanish, French, German, Italian, Portuguese, Russian, Arabic, Japanese
and Korean labels. These exact labels have passed DOM/browser fixtures; they
have **not** been verified against every current live Instagram localization.
Unrecognized controls produce a retryable navigation error after the readiness
deadline, never a username form. Visiting your own Profile section while the
extension waits resumes automatically. Instagram may change its DOM or
translations; universal language compatibility is not claimed.

The 360px popup uses explicit purple/pink/orange/yellow design tokens, readable
type, focused actions and accessible focus states. The original results box is
restyled in place with a themed surface, purple links, responsive width and a
scrollable account list. Counts, field text, ordering, close and profile actions
are preserved. There were no original sort, filter or export controls to remove.
See [DESIGN.md](docs/DESIGN.md) for the design contract.

A compact top-of-page banner shows **⚠️ PLEASE DO NOT SWITCH TABS**, an animated
spinner and the full active-tab reminder. Its closed shadow root exposes no
anchors or dialogs to the checker; `pointer-events: none` leaves page clicks
and scrolling available. There is only one banner, independent of the popup.
It changes to **✓ Checking Complete** for five seconds after successful checking
or a persistent error on failure. Reduced-motion preferences stop animation.

## Build and verify

The checked-in extension is ready to load. Node.js is only needed for development:

```sh
npm run build
npm test
npm run check
```

These commands have no package-install requirement. Build/check fail if the
original bytes change. Optional browser tests need an available Playwright
package and installed Edge; they add no production dependencies:

```sh
npm run test:browser
npm run test:extension
npm run test:timing
npm run test:collector
npm run test:collector -- --real-large --timing-only
```

If Playwright is bundled elsewhere, set `F4F_PLAYWRIGHT_PATH` to that package
directory. `F4F_BROWSER_CHANNEL` defaults to `msedge`. The unpacked-extension
test also requires OpenSSL (`F4F_OPENSSL_PATH` overrides its location; Windows
defaults to Git for Windows' bundled OpenSSL). It creates a temporary profile
and a temporary local TLS certificate, maps Instagram to a local fixture server
and blocks other network hosts. It does not use your regular browser profile.
Temporary integration profiles are left in the system temporary directory.
The reference timing audit takes about 50 seconds on its fixed two-account fixture, uses
actual browser timers, and compares the original anchor-clicking script against
the adapted button-clicking script. It does not use your signed-in account.
The collector suite exercises 1,000–10,000 accounts, virtual/recycled rows,
delayed loading, dialog/wrapper replacements and incomplete scans with a virtual
test clock. Fixture scroll writes retain native geometry and trigger deterministic
loading so browser paint scheduling cannot race the accelerated timers. Its optional
real-timing flags compare the current collector with the original using actual
browser timers. `--real-large --timing-only` runs the healthy 10,000-follower
benchmark; `--real-timing` uses a small healthy fixture. These are local fixture
measurements, not promised live Instagram completion times.

See [VERIFICATION.md](docs/VERIFICATION.md) for actual test results and the
remaining authenticated-Chrome checklist. Visual snapshots are saved locally
in ignored `artifacts/`; fixture examples are labelled as test content.

## Known limits

- Live authenticated Instagram in Google Chrome remains unverified. Automated
  browser checks used Chromium-based Edge and deterministic fixture DOMs.
- Tab-switch throttling depends on Chrome and the live page. The state-only
  test verifies no restart or false completion; it does not establish uninterrupted
  background collection. Keep the Instagram tab active.
- The reference script retains its original limitations. Current scans validate
  totals and bound retries, but Instagram can still hide data, alter markup or
  change memberships without changing totals. No atomic live snapshot is claimed.
  An unavailable exact total prevents verified completion.
- A native Profile control or exact Close label may be unavailable. The own-page
  Edit profile control also confirms identity. Unsupported navigation controls
  may require opening Profile in Instagram while the extension waits; unsupported
  modal controls may still exhibit the original backdrop fallback behavior.
- Large results can exceed session storage capacity; the original on-page list
  stays available and the extension reports a storage error.
- Only one checking operation runs at a time. Browser restart/extension reload
  clears session state and stops the page integration; start another check.

## File inventory

Original file: `f4fchecker.js` — supplied source contents unchanged; Git CRLF
preservation metadata corrected as described above.

Added extension files:

- `extension/manifest.json`
- `extension/service-worker.js`
- `extension/content.js`
- `extension/localization.js`
- `extension/list-controls.js`
- `extension/theme.js`
- `extension/adapter.js`
- `extension/checker-runner.js` (generated, contains original bytes)
- `extension/safe-runner.js` (generated, retains original comparison/output)
- `extension/collector.js`
- `extension/popup.html`
- `extension/popup.css`
- `extension/popup.js`

Added development/documentation files:

- `.gitattributes`
- `.gitignore`
- `package.json`
- `scripts/build.mjs`
- `scripts/check.mjs`
- `tests/integrity.test.mjs`
- `tests/worker.test.mjs`
- `tests/browser.mjs`
- `tests/extension.mjs`
- `tests/timing.mjs`
- `tests/collector.test.mjs`
- `tests/collector-browser.mjs`
- `tests/collector-fixture.mjs`
- `docs/ALGORITHM.md`
- `docs/DESIGN.md`
- `docs/VERIFICATION.md`
- `README.md`

Generated, ignored visual verification files:

- `artifacts/popup-idle.png`
- `artifacts/popup-running.png`
- `artifacts/popup-completed.png`
- `artifacts/popup-error.png`
- `artifacts/popup-waiting_profile.png`
- `artifacts/popup-login_required.png`
- `artifacts/results-desktop.png`
- `artifacts/results-narrow.png`
- `artifacts/warning-running.png`
