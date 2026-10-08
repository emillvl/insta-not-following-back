# F4F Checker for Chrome

A Manifest V3 extension around the supplied F4F Checker browser script. The
original checking file remains **byte-for-byte unchanged**. No server, API
scraper, remote executable code, analytics or runtime dependencies are used.

## Load and use

1. Open `chrome://extensions` in Chrome 112 or newer.
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's
   **extension** folder (the folder containing `manifest.json`, not the root).
3. Pin F4F Checker if desired. Open it from any tab and select **Start Checking**.
4. Instagram is brought to the foreground. Log in if prompted. The extension
   uses an explicitly labelled profile link with an avatar inside a navigation
   container to identify your own profile. If that is unavailable or ambiguous,
   enter your own username in the extension's recovery form; it never guesses
   from whichever profile you happened to be visiting.
5. Keep Instagram open and active until checking finishes. Closing the popup
   does not stop checking. Switching tabs may delay or interrupt it.
6. Read the result box on Instagram, or reopen the extension and select
   **View Results**. Profile links open in new tabs, just as in the original.

The results retain the original Turkish field labels, list order, category
count and following/follower totals. An empty list is a successful original
result with count zero, not an error. Check Again runs the original checker
again. Reloading/navigating away from the checking page or closing that tab
reports interruption; the extension does not silently restart it.

## Architecture and navigation

- `service-worker.js` serializes navigation and lifecycle events, activates the
  selected Instagram tab and focuses its browser window. It prefers the active
  Instagram tab, then an Instagram tab in the current window, then another
  existing Instagram tab; otherwise it creates one active Instagram tab.
- `content.js` runs only in Instagram's top frame. It identifies the own-profile
  navigation link, navigates to that profile, waits for the exact following and
  follower hrefs required by the original, and requests a single run. Login is
  gated and can resume after login. No authentication is bypassed. Recognition
  waits 15 seconds before requesting an explicit username; list readiness has
  a 60-second deadline. These waits are separate from the checker.
- The worker claims the ready page, records **running**, then injects packaged
  `adapter.js` and `checker-runner.js` into Chrome's default **isolated content
  script world**. They operate on the real Instagram DOM and click its controls;
  they need no Instagram JavaScript globals. The original collector's timers,
  retries and scrolling execute in that page's environment.
- `adapter.js` awaits the original async IIFE, captures its original alert as an
  extension error, and requires its genuine results box before completion.
  Injection and profile navigation never count as successful checking.
- `popup.html`, `popup.css` and `popup.js` show idle, navigating, waiting, running,
  completed and error states, including login and username recovery. They use
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
lexical document adapter adds Close-label fallbacks only after the original
selector fails. The lexical alert adapter routes the existing error to status
and the banner instead of a blocking alert. These are interface changes; the
collection, comparison, filtering, categorization and timing remain unchanged.

## Language recognition and design

Profile and list URLs remain independent of Instagram's language. English and
Turkish recognition remains available. The separate Close-label mapping also
handles Spanish, French, German, Italian, Portuguese, Russian, Arabic, Japanese
and Korean labels. These exact labels have passed DOM/browser fixtures; they
have **not** been verified against every current live Instagram localization.
An unrecognized profile label asks for a username. Instagram may change its
DOM or translations; universal language compatibility is not claimed.

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
```

If Playwright is bundled elsewhere, set `F4F_PLAYWRIGHT_PATH` to that package
directory. `F4F_BROWSER_CHANNEL` defaults to `msedge`. The unpacked-extension
test also requires OpenSSL (`F4F_OPENSSL_PATH` overrides its location; Windows
defaults to Git for Windows' bundled OpenSSL). It creates a temporary profile
and a temporary local TLS certificate, maps Instagram to a local fixture server
and blocks other network hosts. It does not use your regular browser profile.
Temporary integration profiles are left in the system temporary directory.

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
- An Instagram navigation container or exact Close label may be unavailable.
  Username recovery covers identity; unsupported modal controls may still fail
  or exhibit the original backdrop fallback behavior.
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
- `docs/ALGORITHM.md`
- `docs/DESIGN.md`
- `docs/VERIFICATION.md`
- `README.md`

Generated, ignored visual verification files:

- `artifacts/popup-idle.png`
- `artifacts/popup-running.png`
- `artifacts/popup-completed.png`
- `artifacts/popup-error.png`
- `artifacts/popup-needs_profile.png`
- `artifacts/popup-login_required.png`
- `artifacts/results-desktop.png`
- `artifacts/results-narrow.png`
- `artifacts/warning-running.png`
