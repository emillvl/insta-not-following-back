# Verification — 8 October 2026

## Version 1.0.1 regression fix

The supplied screenshot showed an authenticated own-profile page with Edit profile
while the extension requested a username. Version 1.0.0 required a nav/aside/role
navigation wrapper and an avatar, and stopped its readiness loop after 15 seconds
when those assumptions failed. That also prevented later manual navigation from
resuming automatically.

Version 1.0.1 clicks the native Profile control, accepts visible links/icons/buttons
without those wrapper/avatar assumptions, recognizes the self-only Edit profile
route or translated label, and keeps waiting through manual/SPA navigation. It
removes the username form and user-supplied-username messaging entirely. Normal
Instagram login is the only authentication interaction. The checker source and
its collection/comparison/delay behavior are unchanged.

Reload the extension on `chrome://extensions` and refresh Instagram before testing
the fix, so the previous page script and stalled session are replaced.

## Automated checks actually performed

- `npm test`: **16 passed, 0 failed**. Covers exact original bytes and embedded
  runner, English/Turkish selectors, additional close labels, conservative own
  profile recognition, visible tab reuse/creation, duplicate starts, genuine
  completion, normal login state, worker state recovery, reload/close errors,
  stale/subframe/wrong-tab messages, no restart on inactive-tab state, injection
  failure, storage quota failure and reopening results in a new tab.
- `npm run check`: passed. Verifies original SHA-256, verbatim embedding,
  referenced manifest assets, Manifest V3, exact restricted permissions, JavaScript
  syntax, absence of remote script/eval/Function/network clients and inline popup
  handlers. The original checksum is also confirmed in the committed Git blob.
- `npm run test:browser`: **31 fixture checks passed** in headless Edge.
  Six full-script differential runs compare original versus extension outputs,
  counts, account fields, ordering, click sequence and requested timer values for
  English and Turkish. Inputs exercise duplicates, list snapshots, reserved-name
  exclusions, query components, case sensitivity and empty lists. Test clocks
  accelerate execution; production timers are unchanged.
  Nine additional localized close-control fixtures pass. Error handling, automatic
  Profile-control clicks without nav/avatar assumptions, Edit profile detection
  in English/Turkish, slashless profile paths, manual navigation after the old
  15-second cutoff, icon/button-only Profile controls, login gating/resume and
  readiness timeout pass. Six actual popup state renders and login continuation
  pass; no username form is present or submitted.
  Original close and profile-link fields are exercised. Desktop/narrow results,
  popup width/button bounds and warning selector/click isolation pass.
- `npm run test:extension`: passed with the real unpacked MV3 extension in a
  temporary Edge profile, using actual Chrome-compatible APIs and isolated-world
  DOM execution. Reproduces an own page with Edit profile and no usable sidebar,
  then verifies active Instagram tab reuse, actual packaged-script
  injection, localized modal closure, execution after the popup closes, genuine
  completion, persisted popup reopening and View Results. A second run verifies
  creation of exactly one foreground Instagram tab, navigation from home to the
  fixture's own profile, automatic execution and completion without pressing
  Start again. A local TLS server/host mapping covers initial browser-created
  navigations; external hosts are blocked. Test-only timers are accelerated.
- Screenshots were generated and visually inspected for running status, profile
  navigation waiting, narrow results and the warning banner. No clipping/hidden recovery
  action was observed. Popup focus indicators and motion preferences are present.
- Git baseline review: `git diff --ignore-space-at-eol 61f2db6 -- f4fchecker.js`
  is empty. Raw changes to that Git blob restore original CRLF encoding only.
  The working source and final committed source both match the supplied 5,818
  bytes and SHA-256 recorded in ALGORITHM.md. Production algorithm code changed:
  **none**. The runner contains the full original file verbatim.

An initial new-tab test fixture missed interception before the browser attached
the new tab and reached Instagram's logged-out page; the extension correctly
reported login-required. The test was corrected to use local TLS host mapping
and blocked external DNS. Final integration runs use local fixtures only.

## Not yet verified against authenticated Google Chrome / live Instagram

Automated fixture results do not establish live Instagram DOM compatibility,
complete live account-list collection, universal translations or uninterrupted
execution after switching tabs. The original algorithm's limitations remain.

Load the `extension` directory at `chrome://extensions`, sign in to your account
normally, then use this checklist:

1. From a non-Instagram tab, Start. Verify an existing Instagram tab is foregrounded
   and navigates to your own profile. Repeat with no Instagram tab; only one should
   open, become active and begin automatically after readiness.
2. From your own profile, Start. Verify reuse and no duplicate tab. Repeat from
   Explore and somebody else's profile; checking must use your own account.
3. While logged out, Start. Verify the login-required message and absence of
   checking. Sign in normally; verify automatic continuation through the native
   Profile control. No username input should appear in the extension. While it
   waits, manually opening your own profile should also continue automatically.
4. Observe the warning and spinner while both original lists are collected. Close
   and reopen the popup; it should still show running. Confirm the banner leaves
   modal close controls and scrolling clickable and creates no extra dialog/anchor.
5. Wait for the real results. Confirm the brief success banner, completed popup,
   original ordered usernames, counts and profile links. Close results, then use
   View Results. Repeat a check with a genuine empty-result account if available.
6. Compare against the standalone original script on identical account-list inputs.
   Real list membership can change between runs; use captured fixtures for exact
   comparisons. Do not regard live differences caused by changed data as proof of
   a changed algorithm.
7. Test English and Turkish, then each additional interface language you use.
   Fixture label matching is already verified; current live labels are not.
8. During a separate test run, briefly switch tabs and return. Record any delay,
   incomplete collection or interruption. There should be no automatic restart
   or false completion. Do not rely on uninterrupted collection in inactive tabs.
9. Reload/navigate away or close the Instagram tab during a run. Reopen the popup
   and verify an interruption error. Retry should start a new operation.
10. With the popup closed, allow the extension worker to suspend naturally, then
    reopen it while the page remains running. Status must agree with the content
    script, and genuine completion must still arrive. Inspect extension errors
    and service-worker logs for unexpected exceptions.
11. Reopen results after closing the Instagram tab; the saved original result
    should display in a new active tab. Restart Chrome or reload the extension;
    session state should reset to idle, as documented.

No authenticated account check, credential collection, account action beyond
the original page interactions, Git push or GitHub publication was performed.
