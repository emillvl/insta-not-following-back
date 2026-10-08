# F4F Checker interface contract

The user wants to check their own account, see genuine operation status and
read the original list of accounts that do not follow back. Start Checking is
the primary idle action. Running shows an indeterminate ring, current stage
and the active-tab reminder. Completed offers View Results and another check.
Errors explain recovery; login and an explicit username fallback appear only
when needed. No invented percentages or additional account categories.

Tokens: white #FFFFFF, near-black #121212, light gray #F5F5F5, purple #833AB4,
pink #C13584, magenta #E1306C, orange #F77737, yellow #FCAF45. Use dark purple
for legible primary buttons and the gradient for decorative accents. System
typography, 8px spacing rhythm, visible keyboard focus, 14–20px type, rounded
surfaces and reduced-motion support. Popup is 360px wide; the original result
box adapts to narrow viewports and long lists.

State and results live in extension session storage, independent of the popup.
The warning uses a shadow root, pointer-events:none and no document-visible
links or dialogs, so it cannot be selected by the original checker. Success
briefly replaces it; errors remain readable. Results keep the original Turkish
field text, ordering and actions. Verification covers idle/running/completed/
error renders, narrow results, focus, action recovery and original close links.
