# Workspace release — September 2026

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
