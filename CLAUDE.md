# Band Calculator (formerly PTO Roaster) — Claude project reference

`AGENTS.md` is the Codex/ChatGPT-side rulebook this project was born with; this file is the Claude-side one. Both describe the same repo. Read only the top "Current state / Next" block of `HANDOFF.md` (`Read` with `limit: 40`); older sessions live in `HANDOFF-archive.md`, open it only when the task needs history. Do not replay completed work.

## What this is

FiveM band calculator, calculator-first since 2026-09-22 (branch `calculator-only`). Anyone can use the calculator (count bands, scan inventory screenshots on-device with vendored Tesseract, quick math) without an account. Signing up is instant; an account saves counts into a running total with cash-outs and a History page. Only the Owner edits prices (Admin page), plus MFA and encrypted backups. Plain ES modules, no framework, no bundler in dev.

```text
Browser (index.html + *.js/*.css, served from disk)
  └─ api-config.js picks the backend from <meta> tags the build injects
       ├─ api.mjs → server.mjs → SQLite .local/pto-dev.sqlite          (localhost:4173, YOUR private data)
       ├─ api.mjs → scripts/sample-server.mjs → in-memory fake data     (localhost:4174, disposable)
       └─ api.mjs → cloudflare-worker.mjs (SQLite Durable Object) → band-calculator.blazzer.workers.dev   (PRODUCTION accounts)
GitHub Pages build (dist/pages): <meta name="band-api"> = the Worker origin (also added to CSP connect-src).
  cloudflare-edge.mjs: CORS for blazzer10200.github.io, SameSite=None;Partitioned cookie, bearer fallback via
  X-PTO-Session (token in localStorage when X-PTO-Remember=1 i.e. "Keep me signed in", else sessionStorage; a sent
  cookie beats the bearer). BAND_API= (empty) builds the old calculator-only site (<meta band-standalone>).
  Workers Free = ~10 ms CPU/request → WORKER_HASH scrypt N=4096 (tagged "s4096.8.1$"); untagged = strong local hashes.
  Worker secrets: BAND_KEY (copy in .local/cloudflare-band-key.txt), SETUP_CODE (.local/cloudflare-setup-code.txt).
  Sign-ups never wait on the Owner when SETUP_CODE is set. Hashing runs in the Durable Object (30 s CPU), so strong
  local hashes are fine there. Local accounts moved in 2026-09-23 via scripts/export-accounts.mjs → one-time
  BAND_SEED secret (loaded only into a DB with no users; deleted after). Put the secret BEFORE deploying new code.
  The stash "WIP: Worker backend port" is an abandoned route (ChatGPT Sites stack, deleted 2026-09-25); not needed.
```

`api.mjs` is the new backend. On first start against an old database it imports bands, deposits (as counts) and payouts (as cash-outs) once (`meta.import_v1`). `calc-model.js` is shared by the browser and `api.mjs`. The legacy `dev-api.mjs` + `*-model.js` + `finance-*` modules stay on disk only because the legacy tests and `import_v1` tests use them. The browser no longer loads them.

## Map

```text
app.js                 routes (#/ calculator, #/history, #/admin), guest vs signed-in header, session polling
calculator-ui.js       Calculator screen (mountCalculator): guest + signed-in modes, running total, cash-out, scanner
history-ui.js          History page: stats, 30-day chart, per-band totals, cash-outs, filterable list, CSV
admin-ui.js            Owner-only: Prices editor (PUT /api/admin/bands w/ pricesRevision), Accounts, Activity, Backups
api.mjs                the backend (routes, schema, legacy import, snapshot/restore); tests in api.test.js
calc-model.js          money, days (America/Chicago, week starts Thursday), band validation; browser + server
band-scan.js           screenshot OCR (ocr-engine/ocr-worker/ocr-core + eng.traineddata.gz, vendored Tesseract).
                       Three passes. Pass 1 sweeps the whole image for "<Color> Stack" names and is used only to
                       locate slots. Those names feed `lattice()`, which infers the slot grid; pass 2 re-reads every
                       cell close up (this is what stops a slot vanishing). Pass 3 crops each slot's count row and
                       splits it at .42: "xN" on the left, the weight read as its own line (`readTiles`). Units are
                       game facts by name (`usualUnit`: band/stack 100 g, Violet 200 g, Loose change 50 g); only
                       names those don't cover borrow this screenshot's units (`inferUnits`/`commonUnit`, multiples
                       of 10 only). Nothing is kept between screenshots. `resolveCount`: sure ONLY when every count
                       read (or an empty count corner = 1) and the labelled weight agree; otherwise flagged with
                       votes (count 1, weight 1.1), then the unlabelled weight, then `qty:null` ("?"). A bare number
                       with no x is a guess: it can make a slot sure by matching the weight, never names the number
                       alone. Every not-sure slot is read again at a tighter crop (`slotRows(...,1)`), cut to black
                       and white at `RETRY_INK` = 80 after the stretch (Tesseract's own threshold blanked thin-ink
                       strips), and both reads are weighed together. Weight repairs: kg without its point ("100k" =
                       1.00 kg), "2008" = 200 g, 0 g = no weight. Contrast is stretched per crop (median =
                       background, so grey hotbar slots read) and long dark runs are painted out as slot borders.
                       Grid lines within
                       2 name-heights are merged — the panel is drawn in perspective and the drift once split one row
                       in two, double-counting every slot on it.
                       PICTURE VIEW (no names, no weights; used only when pass 1 finds no names): slots come from the
                       coloured bar under each filled slot (`findBars`, ±15% of the usual length, so the weight meter
                       is ignored). Money = grey-green bill pixels; the band = the paper stripe's hue/sat (`STRIPES`,
                       white by share, else Loose change). Count = the boxed badge top-right (`findBadge`), all badges
                       read on one line at two sizes after a hard threshold (the contrast stretch broke tiny digits);
                       both reads must agree to be sure. No badge = 1. Every item carries `box` + `confidence`.
                       Bench: `.local/scan/` (gitignored) — hand-counted TRUTH over 9 screenshots, 678 bands, 106
                       slots (shot7/8 = badge view, shot9 = the user's 2026-09-27 example). `pto-scan-harness` in
                       .claude/launch.json serves it on 4180; `viewer.html` there runs the real scan viewer on them,
                       and 4180/index.html is the real app with /api/* proxied to the sample server (4174, never
                       4173). 2026-09-27: 678/678 right, 8/106 slots flagged. Run the bench before and after any
                       scanner change: no band may go wrong, and the flagged count should not grow.
scan-viewer.js         the modal that opens when a screenshot is added: screenshot with a box per slot (hover a row
                       to zoom), editable counts, "Fill in counts" (adds to the tiles once per screenshot), "Not bands"
                       chips to teach a name. Reads nothing itself; draws what band-scan.js returned.
quick-math.js          plain calculator panel
panel-layout.js        "Arrange panels" mode: drag/resize the calculator panels, saved per account.
                       Only active at 820px+; x/w are fractions of the workspace width, y/h are pixels.
auth-ui.js             sign in / create account / setup screens, account dialog (display name + security)
security-*.js / security-*.mjs                  MFA, recovery codes, encrypted backups, activity log
LEGACY (old tests + import_v1 test only, not served to the browser): dev-api.mjs, finance-*.js, model.js,
  access-model.js, hub-model.js, profile-ui.js, member-profile.js, player-picker.js, presence.js
LOOK: "Ledger" (2026-09-25). Flat warm near-black, hairlines not cards, money in Geist Mono; only band colors,
  green (saved) and amber (cash-out / unsaved) are saturated. Load order = index.html <link> order:
tokens.css             every color, font, radius, easing, --gutter (40px, 20px at <=760). Change colors here only.
styles.css             base type, top bar, page frame, footer, .page-heading, .eyebrow, .notice
polish.css             pill buttons, inputs, checkboxes, select menus, account menu, dialog shell, toast
experience.css         keyframes (fade-up, dialog-in, skeleton-pulse, shake…) + the reduced-motion kill switch
auth.css               sign-in split layout (also used by the 2FA, recovery and security-gate screens)
security.css           reminder bar, Account & security dialog, setup wizard, Activity, Backups
calculator.css         calculator: hero, tiles, scanner, scan viewer (.sv-*), quick math, confirm modal, arrange mode,
                       mobile sticky bar
app.css                History, Admin (Prices, Accounts)
                       CSS is kept free of unused selectors; delete a rule when its markup goes.
server.mjs             local dev server, loopback only, port 4173
scripts/dev.ps1        launcher: status/start/restart, PID-guarded
scripts/sample-server.mjs   sample data server (4174)
build*.mjs / client-files.mjs   fingerprinted release build → dist/
docs/DEVELOPMENT.md    routes, stable data-* selectors, sample accounts
.local/                PRIVATE: sqlite db, logs, baselines, old helpers. Gitignored. Never publish, never print.
```

Not navigation targets: `node_modules/`, `dist/`, `.local/`, `*.tgz` at root (old ChatGPT deploy bundles, gitignored).

## Run the app

Browser pane, `.claude/launch.json`:

- `pto-dev` → http://127.0.0.1:4173 — your real local database. Sign in yourself; Claude never types passwords.
- `pto-sample` → http://127.0.0.1:4174 — fake in-memory data. Use this for test counts, cash-outs, price edits, account disabling. Accounts in `docs/DEVELOPMENT.md` (`qa.admin` Owner, `qa.existing`, `qa.fresh`).

Static files are served from disk: reload after editing browser code. Server imports (`*.mjs`) need a restart. Check ports before spawning: `npm run dev:status` / `npm run dev:sample:status`. Never kill a listener you didn't start.

## Claude tooling notes

- No Svelte/Python/Rust here, so `/check` and `/test` have nothing to detect. Use the npm scripts below directly.
- No LSP tool in this install; find symbols with `Grep`. `Grep` honors `.gitignore`, so `.local/` and `dist/` stay out of results.
- Screenshots: `get_page_text` / `read_page` first; screenshot only when layout matters. Use the `data-page`, `data-admin-tab`, `data-finance-quantity` selectors from `docs/DEVELOPMENT.md`.
- Requires Node 24+ (SQLite tests). Installed: v24.19.0.

## Verify

```bash
npm run check          # node --check on every module (syntax)
npm test               # full node --test suite (104 tests, SQLite integration included)
node --test band-scan.test.js   # scanner reading rules (plus the bench above for any scanner change)
npm run test:api       # the calculator backend (api.mjs)
npm run test:finance   # legacy: money, bills, presence
npm run test:access    # legacy: identity, permissions, approvals, auth
npm run verify:build   # check + Pages build + module-graph verify. Builds only, never publishes.
```

CSS/copy-only change: inspect the page at phone + desktop width, then `git diff --check`. JS change: `npm run check` + the focused suite for that domain. Anything touching both API adapters or storage: full `npm test`.

## Rules that bite

- **Never publish unasked.** GitHub Pages deploys only through manual dispatch of `.github/workflows/pages.yml`; the Worker through `npm run cf:deploy` (wrangler, logged in as the user). Both are user-initiated. Worker before Pages when endpoints change.
- **The Worker holds real accounts.** Test with `npm run cf:dev` (local workerd, `.dev.vars`, fresh state in `.wrangler/`), never against production.
- **Never add a login bypass, dev-only credential, or test route.** Use the sample server for other roles.
- **4173 is real data.** No test transactions there. Don't restart it or sign the user out just to check something.
- **No secrets in the repo.** `.local/` holds credentials and baselines. Don't print, copy, or screenshot them.
- Live prices are edited by the Owner on the Admin page (stored in the Worker). `DEFAULT_BANDS` only seeds a fresh database and the calculator-only build. Test the Pages build locally with `pages-preview` (launch.json, port 4190, serves `dist/pages`).
- Money is integer cents. Each saved count snapshots band name/color/price per line; price edits never rewrite history. Saves carry `pricesRevision`, stale ones get 409.
- Deploy only files named in `release.json` from a fresh staging dir.
- `HANDOFF.md`, `HANDOFF-archive.md` and `WEBSITE-REVIEW.md` are deliberately untracked (private ops notes; the repo is public). Keep them that way: never `git add -A` / `git add .` without checking `git status` first.

## Publish targets (for reference, user-triggered only)

- Frontend: https://blazzer10200.github.io/band-calculator/ (repo `Blazzer10200/band-calculator`, renamed from `pto-roaster`; remote name `github`; local folder is still `projects/pto-roaster`)
- Backend: https://band-calculator.blazzer.workers.dev (the user's Cloudflare account, Workers Free, worker `band-calculator`)
