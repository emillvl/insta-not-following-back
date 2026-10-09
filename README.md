# F4F Checker

<img src="extension/icons/logo-512.png" width="96" height="96" alt="F4F Checker logo">

By Emil Valiyev

A Chrome extension that checks which Instagram accounts you follow don't follow
you back. It opens your own profile, reads the following and follower lists, and
shows the results on Instagram. No login credentials needed.

The original browser-console script is on
[DevConsole-Version](https://github.com/emillvl/insta-not-following-back/tree/DevConsole-Version).

## Install and use

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select the `extension` folder.
3. Open F4F Checker and select **Start Checking**.
4. Sign in on Instagram if needed. The extension opens your Profile and continues
   automatically. Keep the Instagram tab open and active.
5. Read the results on Instagram, or reopen the popup and select **View Results**.

After an update, reload the extension and refresh Instagram before starting.

Closing the popup does not stop a check. **Check Again** starts another scan.
Appearance offers **System**, **Light**, and **Dark**. System follows your
computer's preferred mode; the choice is saved across browser sessions.

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

Incomplete loading gets additional waits of 3, 6, and 10 seconds. Each list has
a 20-minute limit. A replaced dialog can reconnect within three seconds of a
paced check; four consecutive replacements without new accounts are allowed.
Missing exact counts, changed profile totals, failed loading, or interruptions
stop the scan without publishing an incomplete result. Rounded labels such as
`10K` require an exact title or accessibility value.

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

Browser checks and logo exports require Playwright and installed Edge:

```sh
npm run test:browser
npm run test:extension
npm run test:collector
npm run test:collector -- --real-timing --timing-only
npm run build:icons
```

Set `F4F_PLAYWRIGHT_PATH` if Playwright is installed elsewhere.
`F4F_BROWSER_CHANNEL` selects another compatible browser channel.
The unpacked-extension test also needs OpenSSL; `F4F_OPENSSL_PATH` can override
its location. Windows defaults to Git for Windows' OpenSSL.
Tests use local fixtures and temporary browser profiles. Screenshots are saved
in the ignored `artifacts` folder.

See [Algorithm](docs/ALGORITHM.md), [Interface](docs/DESIGN.md), and
[Verification](docs/VERIFICATION.md) for implementation and test details.

Instagram can change its markup or hide accounts. Counts and settling cannot
prove a snapshot of memberships that change during checking. Switching tabs can
delay execution. Automated tests use Edge fixtures; they do not establish
compatibility with every live Instagram layout or language.

## License

[Apache License 2.0](LICENSE).
