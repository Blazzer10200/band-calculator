# Workspace release — September 2026

## September 25 (evening) — Scan viewer, picture-only inventories (released)

- **A viewer opens when you add a screenshot.** Your screenshot sits on the left with a box around every
  slot the scanner read: green when it is sure, dashed amber for "double-check this one", red when it
  could not read the count. The right side lists each band with its total. Hover a band to zoom in on its
  slots, change a count with − and +, then press **Fill in counts** to add them to the calculator. Click a
  screenshot's thumbnail to open it again. A screenshot is only ever added once.
- **Picture-only inventories are read.** Some inventory views show just the stacks (no names, no weights)
  with a small boxed count in the top-right corner, and no box when there is one. The scanner now finds
  each slot by the coloured bar under it, tells the band apart by the colour of its paper strap and reads
  the boxed number twice. It only counts as sure if both reads agree.
- Fewer "?" results: when a slot shows a bare number with no ×, the scanner uses it but marks it
  "double-check this one" instead of giving up.
- The drop area now says you can also click to choose a file.
- The page's security policy now allows images the browser makes from your own file (`blob:`), so the
  viewer can show your screenshot. Nothing else changed in it.
- The retired ChatGPT Sites backend and its build files were removed from the project. Every build now
  starts from an empty folder, and the release check fails if anything that is not part of the release
  is in it.

### Checks

- Scanner bench, 8 hand-counted screenshots (2 of them picture-only): 662 bands, every one right.
- `npm test` (96), `npm run check`, `npm run verify:build`, `git diff --check`: pass.
- Viewer on the real bench screenshots at 1280 px and 375 px: boxes line up with the slots, hover zoom,
  stepping (+/−) and Esc all work, and there is no sideways scroll on a phone.
- Sample server (guest): add a screenshot → viewer → Fill in counts → tiles and total update, toast shown;
  reopening the thumbnail shows "Added to this count" and adds nothing more. No console errors.
- The built Pages site under its production security policy: screenshot shows in the viewer, boxes sit on
  the slots, Fill in counts works, no console errors.

## September 25 — New look ("Ledger")

Every screen was restyled: a flat, quiet near-black page with hairline dividers, one big light total and
every money figure in a monospace face. The only strong colors are the band colors, green for saved and
amber for cash-outs and unsaved changes. Counting, saving and cash-outs work the same as before.

- **New logo** and sharper home-screen and link-preview images.
- **Quick math** keeps your last three results (tap one to reuse it), shows the pending operator and has
  one-tap chips for this count and each band price.
- **Recent counts** moved under Count bands.
- **Sign-in** is a split page; two-factor and recovery screens match it.
- **History** has a cleaner chart (cash-out days marked with an amber square), per-band bars and filters.
- **Admin** price edits show the old price ("was …") until you save, accounts can be searched, Activity
  dots are colored by kind and Backups is a two-column page.
- The Account & security dialog has a Sign out button.
- Old unused code, styles and images were removed.

## September 23 — Accounts on the live site (released)

The GitHub Pages site has sign-in again. Accounts live on a Cloudflare Worker
(https://band-calculator.blazzer.workers.dev) that runs the same `api.mjs` in a SQLite Durable Object.

- Anyone can create an account right away; the Owner slot is guarded by a one-time setup code.
- Existing local accounts and their counts were moved over, so old usernames and passwords keep working.
- The Violet band ($25,000) sits right under Yellow.
- The calculator-only build (`BAND_API=`) is still available for a site with no server.

(The September 22 calculator-only notes below are now released as part of this.)

## September 22 — Calculator-only (development only, not released)

Local development site only (branch `calculator-only`). Production is untouched: the cloud backend
(`cloud-api.mjs` / `worker.js`) still serves the old API, so the Pages frontend must not be published
from this branch until that backend is ported.

### User-facing changes

- **The calculator works without an account.** Counting, the screenshot scanner and quick math are
  open to everyone. A guest's count stays on the device for 24 hours and follows them into the account
  they create or sign in to.
- **Anyone can make an account, instantly.** Username and password, no approval step. The
  roster, roles, join requests and treasury screens are gone.
- **A running total with cash-outs.** Saved counts add up until you cash out; cash-out starts the total
  over and the latest one can be undone. Every account can do this for itself.
- **History page.** Today, this week, this month and all time; a 30-day chart with cash-out days marked;
  totals per band; every cash-out; the full list with range/band/search filters and CSV export.
- **Only the Owner changes prices** (new Admin page). Saved counts keep the prices they were saved at.
  A count saved against prices that changed underneath it is refused and re-totalled, never lost.
  Bands already in saved counts can be hidden but not deleted.
- **Admin** also lists accounts (disable/enable; disabling signs the account out), the activity log,
  and encrypted backups.

### Under the hood

- New backend `api.mjs` (SQLite) for both local servers, with tests in `api.test.js`. On first start it
  imports the old database once: bands, open/removed/paid deposits become counts, payouts become
  cash-outs, every existing account is kept. The local database was copied to `.local/archive/` first.
- New browser modules `calculator-ui.js`, `history-ui.js`, `admin-ui.js`, `calc-model.js`, `app.css`;
  the old finance/roster/access modules are no longer served but are still on disk.

## September 21 — The screenshot scanner reads by the slot grid

Frontend-only change. The backend is untouched, and screenshots are still read entirely on your own
device — nothing is uploaded.

### User-facing changes

- **Counts are read off the slot grid, not off one pass over the picture.** The scanner used to read
  the whole screenshot once and trust the result. It now uses that first look only to work out where
  the slots are, then cuts out each slot and reads it close up on its own. Whole slots used to go
  missing when two names ran together into one line; that is what stopped.
- **A count it cannot read now says so.** Where the count and the stack weight cannot be reconciled,
  the slot comes back blank and the panel shows "?" and "N counts not readable" for you to type in.
  It no longer invents a number. A garbled slot could previously be read as a bare "100" and added to
  your total as a hundred bands when it was a stack of ten.
- **Kilograms with a lost decimal point are thrown away.** The panel always prints kilograms with two
  decimals, so a reading like "100k" is a mangled "1.00 kg". Believing it turned ten bands into a
  thousand.

### Fixes

- **A slot could be counted twice.** The game draws the inventory panel in perspective, so the names
  inside one row sit a few pixels lower as you go across. The scanner read that drift as two separate
  rows of slots and added up every slot on them twice: a pocket holding 44 White, 2 Blue and 9 Purple
  came back as 84, 4 and 18. Grid lines closer together than a line of text are now recognised as one
  row. This was the worst of the scanner's faults, because a doubled total looks perfectly normal on
  screen.
- A slot's border came through as one long dark bar and was read as a word, which could swallow the
  count next to it.
- A lone band with no count badge beside it is now understood as one, instead of being guessed at.
- A band that never showed a readable count of its own falls back to what the rest of the screenshot
  weighs per band, rather than being dropped.

### Checks

- Three real inventory screenshots, counted by hand, are read exactly: 505 of 505 bands and every
  slot found, including a small cropped grab of eight slots. Before these changes the same three came
  to 76.7%. Three screenshots is a narrow sample and the bench only catches what is in it, so a
  screenshot the scanner gets wrong is still worth sending in.
- Full test suite green at 99 tests, 13 of them new and covering the count parsing, the stack-size
  learning and the grid inference.

## September 20 — Arrangeable panels, undo a payout, scanner and refresh fixes

Frontend-only change. The backend is unchanged; undo uses the existing reversal endpoint.

### User-facing changes

- **Arrange panels.** A control next to the page title on windows 820 px and wider. Turn it on and each panel gets a name tag you can drag, plus a right and bottom edge you can pull to resize. Arrow keys move a selected panel, Shift and arrow keys resize it. The layout is remembered per account on that device, and "Reset layout" puts everything back. Narrowing the window drops back to the normal stacked layout and leaves arrange mode automatically.
- **Undo the last payout.** Under the running total, the Owner now sees "Undo the $X payout from …" for the most recent payout that has not already been undone. Confirming puts those counts back to "Not paid out yet" and the running total picks up where it left off.
- **Forget what the scanner learned.** The scanner remembers band names it was taught and the stack size it works out per band. If it ever learns a wrong stack size, every later scan inherits it, so there is now a "Forget what the scanner learned" button in the scan panel. It appears only when there is something to forget.

### Fixes

- A count saved while a background refresh was already in flight could be wiped from the screen by that older answer landing afterwards — the count was safe on the server but disappeared from Recent counts and the running total until the next refresh. Refreshes that started before a save are now discarded.
- Removing a screenshot while it was being read left the reader writing its result into nothing and the status stuck on "Screenshot 0 of 1".
- A screenshot that failed to read leaked its decoded image and full-size canvas until the tab was reloaded.
- Leaving arrange mode on and then narrowing the window froze the page's background refreshing with no visible way to switch it off.
- A panel dragged flush to the right edge could then be resized below its minimum width.
- "Fill in counts" could become clickable, and do nothing, after confirming a payout or a removal.
- Background tabs kept polling the server every three seconds; a hidden tab now idles and refreshes when it is brought back.
- The band colour on the Settings page is now escaped like every other value there.
- The sample preview server could not serve the scanner's language file, so screenshot scanning was broken on it.

### Housekeeping

- Eight stale deploy bundles (2.8 MB) moved out of the repository root into the private `.local/archive/`.

### Release checks and delivery

- 86 automated tests passed. `npm run check`, Worker build, Pages build and module-graph verification passed.
- Browser check on the sample server as Owner: save $5,000 → Mark as paid out → running total $0 and the count reads "Paid out" → Undo → back to $5,000 and the count is removable again. Arrange mode gives four drag handles at 1200 px, and narrowing to 375 px exits it, clears the handles, restores refreshing and leaves no sideways scroll. "Forget what the scanner learned" clears the stored names and sizes and then hides itself. No console errors.
- Frontend published through the manual GitHub Pages workflow.

## September 19 (late) — Running total until payout, screenshots clear after save

Frontend-only change. The backend is unchanged; the payout button uses the existing payout endpoint.

### User-facing changes

- The big number at the top is now "Not paid out yet": every count saved since your last payout, plus whatever you are counting right now. Save $20,000, then count $8,200 more and it reads $28,200 while you type and after you save. The band chips add up the same way, and a line under them says how much of the number is still unsaved.
- "Mark as paid out" button under the running total (Owner only, shown when something is unpaid). It asks to confirm, then moves those counts to "Paid out" in Recent counts and starts the running total over from $0. Today, this week and all time are not affected.
- Pasted screenshots are removed from the scanner as soon as the count is saved.

### Release checks and delivery

- 86 automated tests passed. `npm run check`, Worker build, Pages build and module-graph verification passed.
- Browser check on the sample server as Owner: save $20,000 → count $8,200 more → $28,200 before and after saving → Mark as paid out → $0 and both counts show Paid out; a pasted screenshot disappears after save; no sideways scroll at 375 px.
- Frontend published through the manual GitHub Pages workflow.

## September 19 (night) — Running total keeps the saved count

Frontend-only fix. The backend is unchanged.

### User-facing changes

- The running total at the top no longer drops to $0 after "Save count". While nothing is being counted it shows the last saved count (amount, band breakdown, and when it was saved) under the label "Last count saved". As soon as a band is stepped up it switches back to "Counting now" with the new draft.
- The count panel still clears after a save so the next count starts fresh; today, this week, and all time update as before.

### Release checks and delivery

- 86 automated tests passed. `npm run check`, Worker build, Pages build and module-graph verification passed.
- Browser check on the sample server: save a count, running total keeps the saved amount and breakdown, panel resets, count appears in Recent counts.
- Frontend published through the manual GitHub Pages workflow.

## September 19 (evening) — Screenshot scanner, full-screen fit, cleanup

Frontend-only follow-up to the calculator release. The backend is unchanged.

### User-facing changes

- Screenshot scanner rewritten for the game's inventory: it finds every "Colour Stack" name, then reads the slot's `xN` count and stack weight together and cross-checks them (a Purple Stack weighs 100 g each, so "500 g" confirms five). Inventory grids, property storage and the hotbar all read correctly; a count the weight does not agree with is marked "double-check this one". Hotbar slots on a grey panel now read as well as inventory slots on black.
- Each screenshot reads in about one to three seconds after the first, and the reader loads in the background as soon as the calculator opens, so the first screenshot no longer waits.
- Desktop fit: on a 1080p screen the whole calculator (header, running total, count panel, scanner, quick math, recent counts, footer) fits without scrolling. Wide screens use three columns; the header sits on one row. Phone layout unchanged.
- Thinner, darker page scrollbar that blends with the theme.

### Internal cleanup

- `finance-ui.js` dropped the unreachable Treasury, ledger, payout, bills and cashbook code (350 → 280 lines); only the band calculator remains.
- Every stylesheet was pruned of rules whose classes no JS or HTML produces (832 selectors: old roster, contacts, treasury, sidebar and legacy stash layouts). `finance.css` is gone; its confirmation-card rules moved to `calculator.css`.
- No file, route or API change for the backend.

### Release checks and delivery

- 86 automated tests passed. `npm run check`, Worker build, Pages build and module-graph verification passed (32 browser assets).
- Scanner bench on real screenshots: inventory grid, property storage and hotbar samples all match the true counts exactly.
- Browser checks on the local preview: calculator at 1920×1080 with no page scroll and at 375 px with no horizontal overflow; scanner runs in-app under the production Content-Security-Policy.
- Frontend published through the manual GitHub Pages workflow.

## September 19 — Band calculator release

This release turns the site into a single-purpose band calculator. Login, approvals, roles, MFA, and encrypted backups are unchanged. The backend is unchanged; the frontend only stops using endpoints it no longer needs.

### User-facing changes

- The main navigation is **Calculator** plus the permission-filtered **Admin** area (Accounts & access, Join requests, Settings & backups). Roster, Treasury, the member sidebar, earlier-ledger records, and the JSON roster/ledger export-import are removed from the interface. Their stored data is untouched and still present in full encrypted backups.
- Calculator: step or type band counts, see a running total, save counts, and review or remove recent counts. Today / this week / all time totals sit in the hero.
- Screenshot scanner: paste or drop inventory screenshots and the band names are read on the device (vendored Tesseract, Apache-2.0; no upload). Counts are read where the digits are legible; small hotbar counts can still fall back to 1 and should be checked.
- Quick math: a plain calculator panel for odd sums. Nothing there is saved.
- Settings & backups: edit band colors, names, and prices, add or remove bands, reorder them, and rename the website. New workspaces start at the live PTO rates: Loose change $25, White $100, Blue $1,500, Purple $2,500, Brown $6,000, Yellow $12,500.
- Old `#/roster`, `#/treasury`, and `#/contacts` bookmarks open the calculator.
- Content-Security-Policy now allows `'wasm-unsafe-eval'` so the on-device OCR engine can run.

### Release checks and delivery

- 86 automated tests passed after removing the four roster-only tests. `npm run check`, Worker build, Pages build, and module-graph verification passed (33 browser assets).
- Browser checks on the local preview: calculator, settings, accounts, and join requests at desktop and 375 px with no horizontal overflow; legacy routes redirect; no failed requests after reload.
- Frontend published through the manual GitHub Pages workflow. No backend deploy is required for this release.

## September 9 — finance workspace release

This release supersedes the interface and weekly-house-payment descriptions in the historical notes below. Releases use the content fingerprint in the generated `release.json`; the package manifest is not a separate application release counter.

### User-facing changes

- Focused navigation: My stash, Treasury, Roster, and permission-filtered Admin. Calendar, attendance, personal updates, and private-note screens are retired; their saved data remains in the workspace and backups.
- Weekly house obligations are retired. Thursday gang taxes continue. Existing house payment receipts, reversals, schedules, and cashbook entries remain valid.
- A compact login card includes an accessible password eye button, custom remember-me checkbox, clear retry feedback, and grouped access/help links. Registration keeps approval and identity requirements.
- Fixed local remembered-session loss: main and sample previews now use different HttpOnly cookie names, preventing one preview's login or logout from replacing the other's session. Remembered sessions last up to 30 days; session-only cookies retain a 12-hour server limit. Cookie names change once for existing local previews, requiring a fresh local sign-in.
- Custom dropdowns provide consistent chevrons, selected-option checkmarks, keyboard navigation, type-to-find, and screen-aware placement. Existing member/rank pickers share the same styling.
- Page/section transitions respect reduced motion. Keyboard focus, skip navigation, labels, and phone controls are improved.
- Website members appear by gang rank with online/offline status. Activity is website presence within two minutes, not a FiveM or Discord connection. The panel remembers its expanded state separately on desktop and mobile.
- My stash and Treasury remember the last selected section. Settings shortcuts open the requested section directly. The optional security reminder can be dismissed per account/browser without changing authentication requirements.

### Release checks and delivery

- 90 automated tests passed, including local/hosted permissions, MFA and session expiry, finance history preservation, concurrency, and new cross-preview cookie-isolation/database-reopen regressions.
- Browser checks covered login failure/retry, password visibility, registration layout, two remembered preview accounts, independent logout, navigation cancellation with an unsaved draft, and desktop/phone rendering.
- Final static checks, Worker/Pages builds, manifest dependency verification, package contents, and bounded code review are recorded in `docs/RELEASE-PREP.md`.
- Deploy the backend changes before the matching frontend. Keep the existing D1 database and account data. No data reset or destructive migration is part of this release.

## Historical release notes

## September 6 finance simplification

- My stash separates Add bands, Unpaid deposits, and History. Equal-width section buttons and consistent band rows make navigation and entry easier to scan.
- Band quantities support minus/plus buttons as well as direct typing. Controls respect quantity limits and update the deposit total and device draft immediately.
- Treasury opens with compact member payouts and clearly separates member balances, bills due now, and recorded gang cash. Deposit details, receipt filters, and past bill payments expand when needed.
- People profile editing, access changes, and account removal have distinct spacing. Saving roles and opening account deletion are separated by a divider; the deletion form and search fields have consistent gaps.
- Desktop and phone previews cover equal tab and row sizing, quantity controls and limits, saved drafts, partial payments, filters, and account-action spacing.

## September 6 layout correction

- Dashboard and Treasury totals now size to the available width. Narrow screens use full-width cards instead of clipping large balances.
- Finance search and date filters resize within their panels. Headings, receipt summaries, payment actions, and footer controls wrap without covering neighboring content.
- The deposit total and Save button stay in normal form flow, so they do not float over band inputs or notes.
- People role cards separate names from descriptions, preserve checkbox size, and space the role preset buttons. Phone pages use a single page gutter.
- Verified all nine main pages at 320-, 768-, and 1265-pixel browser widths, plus the phone administration tabs, expanded role editor, and payment confirmation. The fixture includes a $13,202,000 balance and long event/receipt text.

## Daily use

- Owner opens on a dashboard for requests, incomplete profiles, money owed, Thursday obligations, upcoming events, and personal updates. Treasurer opens on Treasury; Member opens on My stash. Pages have bookmarkable addresses and browser Back support.
- My stash separates band entry from unpaid deposits and history, with band-color markers, quantity buttons, and a running total. Quantities and notes save as a private device draft for 24 hours. Navigation and reload restore that draft; submitting, discarding, or signing out clears it. Drafts are not submitted deposits and do not sync between devices.
- Treasury separates Pay members, Weekly bills, Deposit history, and Gang cash, with Owner finance settings in the heading. Members receive only their own financial records. Treasury viewers can see all balances; managers can record payments. Owner can confirm their own payout; other managers still need another finance manager for their own payout.
- Full and partial payments apply to the oldest outstanding deposits. A partial payment reduces money owed without inventing a conversion between cash and individual band quantities. The band counts show original contents of still-unpaid deposits.
- Members can withdraw an unpaid deposit and reuse its quantities in a corrected draft. Managers can reject incorrect deposits with a reason. Partly paid deposits require the Owner to reverse their payment before withdrawal or rejection.
- Owner corrections create an attributed reversal, preserve the original receipt, reopen the affected balance, and adjust linked cashbook entries. Nothing silently erases paid history.
- Transactions have reference/name/State-ID search, status and date filters, batches of 20, and CSV export. Cash history has batches of 20 and its own CSV export. CSV text is escaped against spreadsheet formula interpretation.

## Gang money

- Thursday house and gang taxes remain $5,000 each by default, in Central time. Unpaid weeks carry forward; paid, remaining, and overdue totals are visible. Owner can schedule future Thursday amount changes without rewriting existing receipts.
- The optional cashbook begins only when Owner enters the actual opening cash balance. Band submissions create member balances, not cash income. Record money received separately. Later confirmed payouts and weekly bills subtract cash automatically. Earlier payments are not deducted again.
- Cashbook includes income, expenses, Owner reconciliation, and a balance after reserving outstanding bills and member payouts. This is a record of actions taken in game, not a money-transfer integration.
- Owner can require verification for new deposits. A manager verifies quantities, then separately confirms payment. Older deposits keep their original verification requirement.

## People and gang activity

- People is a searchable directory with approved, pending, denied, disabled, and incomplete-profile filters. Expand a person to edit their profile, choose Member/Treasurer/Admin-only presets, preview effective permissions, disable sign-in, or delete the account.
- Actual access changes revoke that person's sessions. Unchanged saves keep sessions. Revision checks prevent an old form from re-enabling a disabled account. Moving pages between navigation categories preserves existing effective permissions.
- Roster rank remains distinct from website access. Owner remains protected. Existing live role assignments are retained; this release does not silently demote other administrators.
- Empty navigation categories and unused band types can be removed. Bands referenced by saved receipts must be made inactive instead.
- Calendar includes events, cancellation history, RSVPs, attendance, and shared away dates. Leadership notes are returned only to users with roster-management access. Personal updates include approvals, payout receipts, deposit corrections, and upcoming events.
- Sign-in includes Show password. Existing remembered sessions, authenticator enrollment, recovery codes, and verified operator recovery remain supported.

## Reliability and operation

- Active pages check changes about every three seconds, use targeted refreshes, and back off after connection failures. Member payout updates can refresh while preserving an unfinished band draft. Price changes retain quantities and require review of refreshed rates.
- Account activity retains the actor's name in new audit records, even after account deletion. Access edits show role and sign-in changes. Older audit entries without a stored actor cannot recover a deleted name.
- Full encrypted backups include account-linked finance, cashbook, calendar, and private notes. Settings clearly labels its smaller roster/earlier-ledger export. Hosted daily backups show their saved UTC day rather than an invented timestamp.
- Browser scripts and styles use content fingerprints. A release indicator offers reload when a newer build becomes available. Builds normalize line endings so Windows and GitHub produce identical browser releases.

## Verification and boundaries

SQLite and hosted D1 regression tests cover privacy, partial payouts, reversals, cashbook accounting, duplicate/stale writes, calendar permissions, private notes, account access conflicts, and backup restoration. Browser walkthroughs cover Owner and Member workflows, two-session payout refresh with a saved draft, role presets, calendar creation, cashbook setup, and a 390-pixel mobile layout.

Discord integrations are intentionally deferred. FiveM presence or character/inventory synchronization still needs the server operator's resources and a separately authorized bridge; no server connection is represented as live. Existing recovery remains identity-checked; no unverified administrative password-reset shortcut was added.

History currently pages its display in the browser. The hosted state document retains its 1.4 MB limit; Owner screens expose a workspace-size estimate, which excludes some security state. Normalized storage, server-side pagination, and push delivery remain scale-driven follow-ups before approaching that limit.
