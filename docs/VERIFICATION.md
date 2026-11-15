# Verification

## 15 November 2026, version 1.1.0

A signed-in trace captured 114 entries from Instagram’s Following responses,
including repeated account IDs. The final page had no next page, and the
checker captured all 111 distinct usernames. The unpacked 1.1.0 integration
fixture reproduces the duplicate counts and recovers 114 distinct Following
accounts with one visible Following status and two exact searches. It uses the
original browser tab and the same-document list routes. The test checks that
the lookup dialog is hidden when it opens and inert during searches, that
Follow Back and deactivated candidates are skipped, and that the result is
exact. Separate fixtures verify zero searches when the only candidates are
marked deactivated.

With the test clock, the duplicate-row fixture took 69 seconds in 1.1.0 and
163 seconds in the 1.0.9 collector with its optional direct-page retry absent.
The two builds verified the same memberships. With real timers, 1.1.0 took
68.6 seconds on that fixture and 49.1 seconds on the healthy fixture, matching
the original checker’s 49.1 seconds. Separate cases cover exact
searches that are still loading and matching suggestions that lack the required
relationship. The latter remain incomplete.

Browser fixtures reproduce a shortfall of 108 out of 114 with the previous
collector. Six plain links were missed when their usernames and display names
were in separate elements. A separate fixture needed to leave the pagination
trigger zone before the remaining six rows could load. The updated collector
reads all 114 in both cases and captures usernames from rapidly recycled links.

The local HTTP 429 fixture verifies the response time, list identification,
cooldown, and resumption. Clock-based tests verify that a two-hour cooldown
expires in the popup and that a subsequent 429 gets a new timestamp. Static
checks detect stale generated runners. Signed-in Instagram checks use the
manual procedure below.

## Earlier verification

8 October 2026, version 1.0.7.

### Recorded checks

| Check | Result |
| --- | --- |
| Unit tests | 21 passed |
| Static checks | Passed |
| Collection fixtures | 25 passed |
| Browser and popup fixtures | 48 passed |
| Unpacked MV3 extension | Passed |

The branding update was rendered in Light and Dark across seven popup states.
Both logos load at the intended size. "By Emil Valiyev" is right-aligned below
Appearance. Buttons remain visible, and neither theme clips horizontally.
Completed popups were visually inspected.

Chrome-compatible extension loading confirms the packaged icon paths, theme
logo, and credit. Static checks verify 16, 32, 48, and 128px PNG dimensions and
toolbar mappings. Separate 512 and 1024px PNGs are included.

Comments were removed from extension, build, and test files. The original source
hash, embedded reference bytes, and production comparison/output bytes pass
integrity checks. Production collection delays and behavior are unchanged.

## Regression coverage

- Following/follower counts: exact localized integers, grouped thousands,
  Arabic/Persian/fullwidth digits, rounded values with an exact title, and
  rejection of missing, ambiguous, or inconsistent evidence.
- Collection: 1,000, 2,000, and 10,000 cumulative accounts; 1,000 and 10,000
  virtual rows; 2,000 recycled anchors; delayed rendering; an 18-second batch
  delay; small and empty lists; replaced scroll containers and dialogs.
- Completion: all 110 rows retained when the profile displays 108, retained
  deactivated rows in the loaded extension, and refusal to publish genuinely
  incomplete lists. Changed counts, permanent loading stalls, closures,
  exhausted dialog recovery, and the hard deadline produce no false result.
- Pacing: at least five seconds from opening to first scroll, 1.5 seconds
  between scroll writes, and four seconds between closing the first list and
  opening the next. Eight stable passes are required.
- Navigation: tab reuse and creation, foreground activation, duplicate starts,
  native Profile controls without nav/avatar wrappers, Edit profile ownership,
  nested spans, buttons, absolute/slashless links, manual navigation after the
  old fifteen-second cutoff, and login continuation without a username form.
- Lifecycle: popup closure, worker state recovery, reload/tab-close interruption,
  stale/subframe/wrong-tab messages, failed injection, saved results reopening,
  quota errors, and no false restart or completion after tab switching.
- Appearance: saved overrides, live System changes, popup/result/banner themes,
  unchanged native page styles, visible actions, reduced motion, and narrow
  result layouts. Supported Close labels have nine additional localized fixtures.
- Reference: six full-script comparisons cover fields, ordering, duplicates,
  reserved names, query components, case sensitivity, empty results, native
  clicks, requested waits, closing, and reopening.

## Recorded timing

These runs used actual browser timers and local account lists.

| Version and fixture | Original | Compared runner |
| --- | ---: | ---: |
| Reference adapter, two-account fixture | 49,186 ms | 49,085 ms |
| 1.0.4 collector, small fixture | 49,128 ms | 2,050 ms |
| 1.0.4 collector, 10,000 followers | 106,383 ms | 9,958 ms |
| 1.0.5 collector, 10,000 followers | 106,431 ms | 9,948 ms |
| 1.0.6 baseline-paced collector, small fixture | 49,123 ms | 49,130 ms |

The faster 1.0.4/1.0.5 cadence was removed in 1.0.6. The baseline-paced healthy
fixture matches the original wait sequence exactly: two 3,000 ms waits, five
2,000 ms waits, and twenty-two 1,500 ms waits. Both lists settle, with identical
accounts and summary. Version 1.0.7 changes branding, documentation, and comments;
it retains that pacing.

## Test environment

Automated browser checks use Edge, local fixtures, and temporary profiles.
The MV3 test maps Instagram to a local TLS server and blocks other external
hosts. No signed-in profile is used. Temporary profiles remain in the system
temporary directory; screenshots and timing records are in ignored
`artifacts/`.

An early new-tab fixture reached Instagram before interception attached and
correctly reported login required. TLS host mapping fixed the fixture.
An accelerated loading test also exposed a paint/scroll-event race. Fixture
scroll writes now start loading deterministically while retaining native
geometry; production timings were not changed for that test.

The original file and committed blob retain the supplied 5,818 bytes and SHA-256.
The baseline Git commit's CRLF normalization was corrected in the index without
editing the working original. Its diff against `61f2db6` is empty with
`--ignore-space-at-eol`.

## Live checks

Live Instagram markup and translations can differ from fixtures. Counts and
settling do not prove an atomic snapshot or exposure of every account.
Background throttling or a frozen browser can delay timers. No live account
restriction or anti-bot behavior was established by the supplied screenshots.

After reloading the extension and refreshing Instagram:

1. Start from another website and from your own profile. Check foreground tab
   reuse, native Profile navigation, and absence of duplicate tabs.
2. Repeat while logged out. Sign in normally and check automatic continuation.
3. Close and reopen the popup during a scan. Confirm the banner leaves Instagram
   controls clickable and completion agrees with the popup.
4. Compare the result with the visible lists, including deactivated accounts.
   Close it and reopen View Results; also check an empty result.
5. Check your interface languages, reload/tab-close interruptions, live theme
   changes, and recovery after a retry.
6. Reopen results after closing the Instagram tab, then restart the browser and
   confirm session state resets. Appearance should remain saved.
