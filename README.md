# F4F Checker

<img src="extension/icons/logo-512.png" width="96" height="96" alt="F4F Checker logo">

By Emil Valiyev

A browser extension that checks which Instagram accounts you follow don't
follow you back. It opens your own profile, reads the following and follower
lists, and shows the results on Instagram. A signed-in Instagram session is
required.

The original browser-console script is on
[DevConsole-Version](https://github.com/emillvl/insta-not-following-back/tree/DevConsole-Version).

## Install and use

In Microsoft Edge, install F4F Checker from
[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/f4f-checker/nkkjgaclfdeidnccmjiemcjdmeooobfj).
For Google Chrome, download or clone this repository.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the repository's `extension` folder.

Open F4F Checker from the browser's **Extensions** menu and select
**Start Checking**. The extension opens Instagram or reuses an open Instagram
tab. Keep that tab open and active while the extension opens your profile and
checks both lists.

Read the results on Instagram or reopen the popup and select **View Results**.
Closing the popup does not stop a check. **Check Again** starts another scan
after a completed check. **Appearance** offers **System**, **Light**, and
**Dark**. System follows your computer's preferred mode. The choice is saved
across browser sessions.

After updating an unpacked install, select **Reload** on the extension card and
refresh any open Instagram tabs before starting.

### Troubleshooting

- **Login required.** Sign in directly on Instagram. If the popup still shows
  **Login required** afterward, select **Continue After Login**.
- **Getting ready.** If the extension is waiting for your profile, open your
  own Profile from Instagram's menu so it can find the two list controls.
- **Incomplete scan.** Close any open Instagram list, refresh your profile,
  and select **Retry Checking**. An incomplete scan produces no comparison.

## Checking

The checker uses Instagram's native controls and the original script's pacing:
three seconds after opening a list, two seconds before collection, 1.5 seconds
per scroll pass, and two seconds after closing. It waits another two seconds
between lists and requires eight stable passes before finishing. New rows never
shorten these waits.

Rows are captured before scrolling and as Instagram adds, removes, or reuses
them. Scrolling stays within captured rows so virtual lists aren't skipped.
Completion requires settled lists with at least the displayed totals.
Deactivated accounts remain included when the collected total is higher.

When the list settles before the scan can be verified, the checker gives it up
to 19 seconds to make progress. If the count is short and no loader is visible,
it can revisit the end once at the usual pace. Each list has a 20-minute limit.
A replaced dialog can reconnect within three seconds of a paced check. Four
consecutive replacements without new accounts are allowed.
Missing exact counts, changed profile totals, failed loading, or interruptions
stop the scan. Rounded labels such as `10K` require an exact title or
accessibility value.

The results keep the original Turkish labels, account order, totals, and profile
links. An empty result is a completed check with zero accounts.

## Storage and privacy

The extension has no server or analytics and does not read or store your login
credentials. Instagram receives the normal page interactions used to load its
lists. Permissions are limited to storage, script injection, and Instagram.

Results use local session storage. They survive closing the popup and can be
reopened after closing the result box or Instagram tab. Browser restart or
extension reload clears them. Appearance uses local storage and persists.
If a result exceeds storage capacity, the on-page list remains available.

## Logo

The popup, toolbar, and extension listing use the same f4f↗ mark.

- [1024px PNG](extension/icons/logo-1024.png)
- [512px PNG](extension/icons/logo-512.png)
- [SVG source](extension/icons/logo.svg)

The PNG files have transparent rounded corners. The extension includes 16, 32,
48, and 128px icons and a light-mode popup variant.

## Development

Node.js is needed only for development. The checked-in extension is ready to load.

```sh
npm run build
npm test
npm run check
```

The build verifies that `f4fchecker.js` is unchanged and generates both runners.
The production runner uses the safer collector while keeping the original
comparison and result construction. The reference runner contains the full
original script.

Browser checks and logo exports use Playwright and default to Microsoft Edge.

```sh
npm run test:browser
npm run test:extension
npm run test:collector
npm run test:collector -- --real-timing --timing-only
npm run test:timing
npm run build:icons
```

Set `F4F_PLAYWRIGHT_PATH` if Playwright is installed elsewhere. Set
`F4F_BROWSER_CHANNEL=chrome` to run `test:browser`, `test:collector`, or
`test:timing` in Google Chrome. Run `test:extension` with its default Edge
channel. It also needs OpenSSL, which defaults to Git for Windows' OpenSSL on
Windows. Set `F4F_OPENSSL_PATH` to specify another location.
Tests use local fixtures and temporary browser profiles. Screenshots are saved
in the ignored `artifacts` folder.

See [Algorithm](docs/ALGORITHM.md), [Interface](docs/DESIGN.md), and
[Verification](docs/VERIFICATION.md) for implementation and test details.

Instagram can change its markup or hide accounts. Counts and settling cannot
prove a snapshot of memberships that change during checking. Switching tabs can
delay execution. Live Instagram layouts and languages can differ from the test
fixtures.

## License

[Apache License 2.0](LICENSE).
