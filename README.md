# Instagram Follow-Back Analyzer

A lightweight browser-console utility that compares the accounts you follow with the accounts that follow you, then shows the accounts that do not follow you back.

The script runs entirely in the Instagram page you already have open. It does not require a backend, account password, API token, browser extension, or external service.

## What it does

- Opens your Following list.
- Scrolls through the list and collects account usernames.
- Opens your Followers list and does the same.
- Compares both sets locally in your browser.
- Displays the accounts you follow that are not following you back.
- Shows follower/following totals in the result overlay.

The current implementation uses DOM text and link structure rather than Instagram's private APIs.

## How to use

1. Open Instagram in a desktop browser and sign in.
2. Go to **your own profile page**.
3. Open Developer Tools.
4. Open the **Console** tab.
5. Copy the contents of:

```text
Social Media/f4fchecker.js
```

6. Paste the script into the console and run it.
7. Leave the tab open while the script collects both lists.
8. When finished, the result overlay will appear on the page.

Common console shortcuts:

- Chrome / Edge on Windows or Linux: `Ctrl + Shift + J`
- Chrome / Edge on macOS: `Cmd + Option + J`

Browser shortcuts can vary.

## Why it takes time

Instagram loads follower and following lists incrementally while you scroll.

The script therefore waits between scrolls and stops only after the list remains stable for several iterations. These pauses are intentional: removing them can make the script finish before Instagram has rendered the complete list.

Larger accounts will naturally take longer to process than smaller ones.

## Data and privacy

The script performs its comparison locally in the browser page.

It does **not** contain code that:

- asks for or stores your Instagram password;
- sends your follower/following lists to a project-controlled server;
- uses an external analytics endpoint;
- requires cookies, session tokens, or credentials to be copied out of the browser.

You should still review browser-console scripts before running them. A console script executes with access to the page in which you paste it.

## Current behavior

The script currently recognizes English and Turkish labels for Followers and Following.

It gathers usernames from profile links inside Instagram's follower/following dialogs and filters obvious non-profile paths such as `/explore` and `/reels`.

Results are displayed in an overlay containing:

- the number of accounts not following you back;
- following count;
- follower count;
- clickable profile links.

## Troubleshooting

### "following/followers link could not be found"

Make sure you are on your own Instagram profile page before running the script.

Instagram also changes its interface regularly. If the follower/following labels or DOM structure change, the selector logic may need an update.

### "Modal bulunamadı"

The script clicked the follower/following control but could not detect the resulting dialog.

Possible causes include:

- Instagram changed the dialog structure;
- the page is still loading;
- the control did not open;
- a browser extension altered the page;
- the UI language uses labels the script does not currently recognize.

Reload the profile page and try again before assuming the script is broken.

### The result count looks incomplete

Do not interact heavily with the page while collection is running.

Very large lists, temporary Instagram loading issues, connection problems, or DOM changes can affect collection. Check the browser console for progress messages such as:

```text
Collected 428 users, stability: 2/8
```

### The script stopped working after previously working

This project depends on Instagram's rendered web interface, which Meta can change without notice.

A working version today can require selector or timing adjustments after a future Instagram update. This is the main maintenance risk of the project.

## Technical overview

The implementation is a single asynchronous JavaScript routine.

Key ideas:

- `Set` is used for deduplication and efficient membership checks.
- usernames are derived from profile-link `href` values rather than display text;
- list completion is estimated using both scroll-height stability and whether new usernames are still appearing;
- follower/following dialogs are closed using several fallback selectors;
- the final comparison is performed locally with `Set.has()`.

There are no runtime dependencies or build steps.

## Project structure

```text
insta-not-following-back/
├── Social Media/
│   └── f4fchecker.js
├── LICENSE
└── README.md
```

## Limitations

- The script depends on Instagram's current web DOM.
- It is intended for use from a logged-in profile page in a desktop browser.
- English and Turkish follower/following labels are currently supported.
- Instagram can rate-limit, delay, or change how long lists load.
- The script does not use Instagram's official API.
- It does not automatically unfollow anyone or modify your account relationships.

## Responsible use

This is an independent project and is not affiliated with, endorsed by, or supported by Instagram or Meta.

Use it only on accounts and sessions you are authorized to access. Running scripts in a website console may be subject to that service's terms and policies.

## License

Licensed under the **Apache License 2.0**.

See [LICENSE](LICENSE) for the complete terms.

The Apache-2.0 license permits use, modification, and redistribution under its stated conditions, including preservation of required notices.

## Author

Emil Veliyev — [@emillvl](https://github.com/emillvl)
