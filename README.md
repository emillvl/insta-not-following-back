<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="extension/icons/logo-light-128.png">
    <img src="extension/icons/logo-512.png" width="88" height="88" alt="">
  </picture>
  <h1>F4F Checker</h1>
  <p>See who doesn't follow you back on Instagram.</p>
  <p>By Emil Valiyev</p>
  <p>
    <a href="https://microsoftedge.microsoft.com/addons/detail/f4f-checker/nkkjgaclfdeidnccmjiemcjdmeooobfj"><strong>Install for Edge</strong></a>
    &nbsp;·&nbsp; <a href="#install-in-chrome">Set up in Chrome</a>
    &nbsp;·&nbsp; <a href="#run-a-check">Run a check</a>
  </p>
  <img src="docs/images/popup-light.png" width="250" alt="Example F4F Checker results in Light mode">
  <img src="docs/images/popup-dark.png" width="250" alt="The same example results in Dark mode">
</div>

## Install in Chrome

Download or clone this repository. The `extension` folder is ready to load.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder.

After updating an unpacked copy, select **Reload** on its extension card and
refresh your Instagram tabs.

## Run a check

1. Open F4F Checker from the browser's Extensions menu and select **Start Checking**.
2. Sign in on Instagram if asked. F4F Checker opens your profile and reads your
   Following and Followers lists. Keep that tab active until the check finishes.
3. Read the results in the Instagram tab. You can also reopen the extension and
   select **View Results**, or start over with **Check Again**.

You can close the popup during a check. Pick **Light**, **Dark**, or **System**
under **Appearance**. System follows your computer's theme, and the extension
remembers your choice between sessions.

### When the check pauses

| Message | What to do |
| --- | --- |
| 🔑 Login required | Sign in on Instagram. If the check is still waiting, choose **Continue After Login**. |
| Getting ready | Open your own profile from Instagram's menu so F4F Checker can find both lists. |
| ⚠️ Incomplete scan | Compare the count in the message with the one on your profile. Give Instagram time to load the list, then choose **Retry Checking**. |
| ⏳ Instagram rate limit | The notice shows when Instagram returned HTTP 429 and any retry time it provided. **Retry Checking** becomes available after that time. |

## How it works

F4F Checker uses the same Following and Followers dialogs you open on your own
Instagram profile. It reads account links as rows load or are reused during
scrolling. If a list comes up short, it checks relationship labels from the other
list first. It can then search for exact usernames out of view in the same tab.
A check allows up to four exact search inputs, including any retry, and skips
searches for accounts marked deactivated. Deactivated accounts count when their
profile links appear in the list.

Results appear once both lists settle and reach at least the totals on your profile.
The result shows who doesn't follow you back, with links to their profiles and
totals for both lists. A result of zero means the comparison finished and found
no missing follow-backs.

<details>
<summary>Timing, counts, and retries</summary>

The checker waits three seconds after opening each list and two more before
collection. Scroll passes are 1.5 seconds apart. It waits two seconds after
closing a list and another two before opening the second list. It needs seven
stable passes at the end of a complete list. A short list can get a rewind to
load another page, and a visible loading indicator gives Instagram more time.
Both lists share a 20-minute limit.

If Instagram returns HTTP 429 on a list request, the check pauses until the
`Retry-After` time. It can retry once if the wait fits within the check. A second
429 or a response without a usable future retry time stops the check.

A list dialog that disappears gets three seconds to return. The checker allows
four replacements in a row without new accounts. A rounded count such as `10K`
requires an exact number in the tooltip or accessible label. Changed totals,
unavailable counts, loading failures, or an interrupted check can stop results
from appearing. Instagram can hide accounts or change a list during a check.
Switching tabs can delay the scan, and live layouts can differ from the fixtures.

</details>

## Privacy

You sign in on Instagram. Your login credentials stay with Instagram. F4F Checker
reads the lists in your browser and has no server or analytics. The extension
uses browser storage, runs its scripts on Instagram, and reads rate-limit
responses from the tab doing the check. Instagram handles the regular clicks,
scrolls, and searches used to load your lists.

Results stay in browser session storage. You can reopen them after closing the
popup, result box, or Instagram tab. A browser restart or extension reload
clears them. If the result is too large to save, it stays open in the Instagram
tab. Appearance is saved separately. [Privacy policy](PRIVACY.md)

## Develop and test

The original browser-console script is in the
[DevConsole-Version](https://github.com/emillvl/insta-not-following-back/tree/DevConsole-Version)
branch. For development, install Node.js and run:

```sh
npm run build
npm test
npm run check
```

The build checks the original `f4fchecker.js` and generates two runners. The
reference runner contains the full original script. The extension's runner
uses the list collector and keeps the original comparison and result data.

<details>
<summary>Browser checks and logo exports</summary>

Browser checks and logo exports use Playwright with Microsoft Edge by default.

```sh
npm run test:browser
npm run test:extension
npm run test:collector
npm run test:collector -- --real-timing --timing-only
npm run test:timing
npm run build:icons
```

Set `F4F_PLAYWRIGHT_PATH` if Playwright is installed elsewhere, or
`F4F_BROWSER_CHANNEL=chrome` to use Google Chrome. `test:extension` also needs
OpenSSL. On Windows it defaults to `mingw64/bin/openssl.exe` from Git for Windows.
Set `F4F_OPENSSL_PATH` to use another copy.

Tests use local fixtures and temporary browser profiles. Screenshots go in the
ignored `artifacts` folder.

The popup, toolbar, and listing use the f4f↗ logo. The PNGs have transparent
rounded corners. The extension includes 16, 32, 48, and 128px icons and a Light
variant for the popup. [1024px PNG](extension/icons/logo-1024.png) ·
[512px PNG](extension/icons/logo-512.png) · [SVG source](extension/icons/logo.svg)

</details>

[Algorithm](docs/ALGORITHM.md) · [Interface](docs/DESIGN.md) ·
[Verification](docs/VERIFICATION.md) · [Apache License 2.0](LICENSE)
