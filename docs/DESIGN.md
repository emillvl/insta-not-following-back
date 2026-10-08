# F4F Checker interface contract

The user wants to check their own account, see genuine operation status and
read the original list of accounts that do not follow back. Start Checking is
the primary idle action. Running shows an indeterminate ring, current stage
and the active-tab reminder. Completed offers View Results and another check.
Errors explain recovery; logged-out users sign in normally on Instagram. Start
uses Instagram's native Profile control and automatically continues on the own
profile page. There is no username form. No invented percentages or additional
account categories.

Tokens: white #FFFFFF, near-black #121212, light gray #F5F5F5, purple #833AB4,
pink #C13584, magenta #E1306C, orange #F77737, yellow #FCAF45. Use dark purple
for legible primary buttons and the gradient for decorative accents. System
typography, 8px spacing rhythm, visible keyboard focus, 14–20px type, rounded
surfaces and reduced-motion support. Popup is 360px wide; the original result
box adapts to narrow viewports and long lists.

Appearance is a compact labelled select below the checking actions, available
in every popup state. Choices are System (default), Light and Dark. System
follows `prefers-color-scheme` live; explicit choices override it. Dark uses
Instagram-style #0C1014 background, #151A1F surfaces, #2B3036 borders and #F5F5F5
text, with a lighter purple for readable links and the existing purple action
button. Shared tokens cover controls, muted text, errors, focus, results and the
shadow-root banner. Theme changes neither alter Instagram's native appearance
nor change checking state, output or timing. The preference lives in local
extension storage and survives closing/reopening the popup and browser sessions.

State and results live in extension session storage, independent of the popup.
The warning uses a shadow root, pointer-events:none and no document-visible
links or dialogs, so it cannot be selected by the original checker. Success
briefly replaces it; errors remain readable. Results keep the original Turkish
field text, ordering and actions. Verification covers idle/running/completed/
error renders, narrow results, focus, action recovery and original close links.
