# Interface

The popup is 360px wide. Its order is logo and title, status, checking actions,
appearance, then the right-aligned "By Emil Valiyev" credit.

The f4f↗ logo uses the existing rounded tile and lettering. Dark mode uses
#251B30 with #C58CE8 lettering; Light uses #F6EDF9 with #833AB4 lettering.
Packaged PNGs keep the mark consistent across platforms. The same dark mark is
used for Chrome's toolbar and extension listing.

Start Checking opens Instagram and uses its native Profile control. Logged-out
users sign in on Instagram and checking continues automatically. There is no
username form.

Running shows an indeterminate ring, current collected counts, and the reminder
to keep Instagram active. Counts above the displayed total are labelled with
" profile shows " rather than treated as an error. Completion requires settled
lists and enough collected accounts, including deactivated rows.

Completed shows the original Turkish result fields, View Results, and Check
Again. An incomplete scan offers Retry Checking and hides View Results.
Other errors explain how to resume. A storage error keeps the verified on-page
list available.

Appearance is available in every state. System follows the computer's live
light/dark preference; Light and Dark override it. The choice is stored locally.
Dark uses #0C1014 backgrounds, #151A1F surfaces, #2B3036 borders, and #F5F5F5
text. Purple #833AB4 is the primary action color. Pink #C13584, magenta #E1306C,
orange #F77737, and yellow #FCAF45 appear in the top accent.

The popup uses system fonts, visible keyboard focus, and reduced-motion support.
Result boxes fit narrow screens and scroll long lists. Themes affect extension
surfaces without changing Instagram's appearance or the scan.

State and results use session storage. The warning banner has a closed shadow
root and does not intercept clicks or expose list links. Success stays visible
for five seconds; errors remain until the next operation.
