# Verification

## 15 November 2026, version 1.1.0

The prior signed-in trace captured 114 Following records with repeated IDs and
111 distinct usernames. Instagram marked the final page complete. The separate
108-of-114 pagination fixture gets six more accounts after a rewind and return
to the end. A third fixture covers link markup where usernames and display
names use separate elements. The collector tests compare the full expected
sets and the exact non-follower result.

### Unpacked Chrome request counts

The local HTTPS server counted requests it actually received. Chrome's isolated
world counted scroll writes separately. Healthy timings are for two successive
checks in the same tab, run with real timers. Counts in those rows are per check.

| Fixture | Build | Wall time (s) | List opens (reopens) | Scroll writes | Pages | Exact searches | List requests | Verified Following / Followers |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Healthy | 1.0.7 `6e7b801` | 49.24 / 49.31 | 2 (0) | 22 | 0 | 0 | 2 | 2 / 2 |
| Healthy | 1.1.0 `2f2d516` | 49.35 / 49.30 | 2 (0) | 2 | 0 | 0 | 2 | 2 / 2 |
| Healthy | Revised 1.1.0 | 46.34 / 46.30 | 2 (0) | 2 | 0 | 0 | 2 | 2 / 2 |
| 108 of 114 | 1.0.7 | 40.67 | 1 (0) | 11 | 1 | 0 | 2 | Incomplete |
| 108 of 114 | Starting 1.1.0 | 67.36 | 2 (0) | 4 | 2 | 0 | 4 | 114 / 2 |
| 108 of 114 | Revised 1.1.0 | 64.33 | 2 (0) | 4 | 2 | 0 | 4 | 114 / 2 |
| 114 records, 111 distinct | 1.0.7 | 40.67 | 1 (0) | 11 | 0 | 0 | 1 | Incomplete |
| 114 records, 111 distinct | Starting 1.1.0 | 68.87 | 3 (1) | 4 | 0 | 2 | 5 | 114 / 115 |
| 114 records, 111 distinct | Revised 1.1.0 | 67.34 | 3 (1) | 4 | 0 | 2 | 5 | 114 / 115 |
| Persistent 429, no header | 1.0.7 | 1.89† | 1 (0) | 11 | 1 | 0 | 2 | Incomplete |
| Persistent 429, no header | Starting 1.1.0 | 41.62† | 1 (0) | 11 | 6 | 0 | 7 | Stopped |
| Persistent 429, no header | Revised 1.1.0 | 0.36† | 1 (0) | 1 | 1 | 0 | 2 | Stopped |

† The persistent-429 fixture accelerated the extension clocks 24× and used
actual HTTPS responses. The starting 1.1.0 continued for about 16m 39s of modeled
check time. It made five further pagination requests after the first 429.
The revised build made zero. A separate assertion checked that the request
count stayed fixed past the former first wait and that Retry Checking started
a new manual attempt.

The overlapping-response fixture issued two opening requests together. It
delivered the second response after the first advertised wait had already
expired. Across a Chrome extension worker restart, there were zero retries
before the later deadline and one afterward. The retry received another 429
and ended the check. Other cases cover pagination that succeeds on its one
retry, a search replay, a search that stops on a no-header 429, malformed and
long waits, an unrelated feed 429, popup and page expiry without new rows,
duplicate Starts, reloads, and tab closure. The duplicate-row fixture keeps
one Following reopen and two hidden, inert searches. It excludes candidates
labelled Follow Back or deactivated. Missing or conflicting relationship
evidence produces an incomplete result.

### Large fixtures

Chrome renderer metrics used an accelerated fixture clock. The cumulative
case has 10,000 accounts per list and relationship buttons on Following rows.
The virtual case has 10,000 followers. Heap peaks are samples and retained heap
was measured after garbage collection.

| Fixture | Progress messages before → after | JavaScript time (ms) | Sampled heap (MiB) | Retained heap (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Cumulative | 104 → 82 | 83 → 88 | 5.59 → 4.50 | 2.25 → 2.26 |
| Virtual | 650 → 628 | 83 → 79 | 3.95 → 3.98 | 2.23 → 2.24 |

The archived build can be selected with `F4F_TEST_EXTENSION`. Use
`node tests/requests.mjs --benchmark` for request counts and
`npm run test:collector -- --scale-audit` for the large fixtures.

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
  opening the next. A verified end needs seven stable passes.
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

Automated browser checks use local fixtures and temporary profiles. The current
measurements used Google Chrome on Windows.
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
Background throttling or a frozen browser can delay timers. The supplied live
Following 429 had an empty body and no usable retry time. The reason for that
rejection, how long it lasted, and its first-use frequency remain unknown.
The revised build was verified in isolated Chrome fixtures.

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
