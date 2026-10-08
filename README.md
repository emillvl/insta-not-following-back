# F4F Checker for Chrome

A Manifest V3 extension around the supplied F4F Checker browser script. The
original checking file remains **byte-for-byte unchanged**. No server, API
scraper, remote executable code, analytics or runtime dependencies are used.

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
result with count zero, not an error. Check Again runs the original checker
again. Reloading/navigating away from the checking page or closing that tab
reports interruption; the extension does not silently restart it.

After updating the unpacked extension to **1.0.2**, click its Reload button on
`chrome://extensions`, refresh the Instagram page, then select Start Checking.
Refreshing replaces the previous content script and its stalled wait state.

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
  controls or nested count spans to their actual native click target. Only the
  original top-level list-opening selector receives this compatibility wrapper.
  Account collection inside dialogs remains unchanged, with the original waits,
  retries and eight-stable-pass stopping condition.
- The worker claims the ready page, records **running**, then injects packaged
  `adapter.js` and `checker-runner.js` into Chrome's default **isolated content
  script world**. They operate on the real Instagram DOM and click its controls;
  they need no Instagram JavaScript globals. The original collector's timers,
  retries and scrolling execute in that page's environment.
- `adapter.js` awaits the original async IIFE, captures its original alert as an
  extension error, and requires its genuine results box before completion.
  Injection and profile navigation never count as successful checking.
- `popup.html`, `popup.css` and `popup.js` show idle, navigating, waiting, running,
  completed and error states, including normal Instagram login recovery. They use
  indeterminate indicators, never fabricated percentages.
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
The build embeds its entire byte sequence in the packaged runner, without
rewriting or extracting its functions. The original is still usable standalone.

The baseline Git commit initially normalized CRLF to LF because Git's existing
configuration enabled automatic line-ending conversion. `.gitattributes` now
marks the original and runner as binary-preserved text; renormalization restored
the supplied CRLF bytes **in Git's index only**. The working original was never
edited. A raw baseline diff therefore shows line endings; the baseline diff
with `--ignore-space-at-eol` is empty. The committed original now has the exact
supplied SHA-256 and will retain it on future checkouts.

All production changes are in separate integration/presentation files. The
lexical document adapter adds Close-label fallbacks and native list-control
recognition when an original selector fails. Its wrappers retain native DOM
clicks and do not modify account collection. The lexical alert adapter routes the existing error to status
and the banner instead of a blocking alert. These are interface changes; the
collection, comparison, filtering, categorization and timing remain unchanged.

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
restyled in place with a white surface, purple links, responsive width and a
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
```

If Playwright is bundled elsewhere, set `F4F_PLAYWRIGHT_PATH` to that package
directory. `F4F_BROWSER_CHANNEL` defaults to `msedge`. The unpacked-extension
test also requires OpenSSL (`F4F_OPENSSL_PATH` overrides its location; Windows
defaults to Git for Windows' bundled OpenSSL). It creates a temporary profile
and a temporary local TLS certificate, maps Instagram to a local fixture server
and blocks other network hosts. It does not use your regular browser profile.
Temporary integration profiles are left in the system temporary directory.
The timing audit takes about 50 seconds on its fixed two-account fixture, uses
actual browser timers, and compares the original anchor-clicking script against
the adapted button-clicking script. It does not use your signed-in account.

See [VERIFICATION.md](docs/VERIFICATION.md) for actual test results and the
remaining authenticated-Chrome checklist. Visual snapshots are saved locally
in ignored `artifacts/`; fixture examples are labelled as test content.

## Known limits

- Live authenticated Instagram in Google Chrome remains unverified. Automated
  browser checks used Chromium-based Edge and deterministic fixture DOMs.
- Tab-switch throttling depends on Chrome and the live page. The state-only
  test verifies no restart or false completion; it does not establish uninterrupted
  background collection. Keep the Instagram tab active.
- The original algorithm may return incomplete lists when Instagram changes
  its list virtualization, may fail on a changed modal DOM, and has no timeout
  while list contents/heights keep changing. These original limitations were
  deliberately preserved. No API fallback or new pagination logic is used.
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
- `extension/adapter.js`
- `extension/checker-runner.js` (generated, contains original bytes)
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
