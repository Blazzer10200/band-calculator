# Band Calculator (formerly PTO Roaster) — Claude project reference

`AGENTS.md` is the Codex/ChatGPT-side rulebook this project was born with; this file is the Claude-side one. Both describe the same repo. Read `HANDOFF.md` before starting. Do not replay completed work.

## What this is

FiveM band calculator, calculator-first since 2026-09-22 (branch `calculator-only`). Anyone can use the calculator (count bands, scan inventory screenshots on-device with vendored Tesseract, quick math) without an account. Signing up is instant; an account saves counts into a running total with cash-outs and a History page. Only the Owner edits prices (Admin page), plus MFA and encrypted backups. Plain ES modules, no framework, no bundler in dev.

```text
Browser (index.html + *.js/*.css, served from disk)
  └─ api-config.js picks the backend from <meta> tags the build injects
       ├─ api.mjs → server.mjs → SQLite .local/pto-dev.sqlite          (localhost:4173, YOUR private data)
       ├─ api.mjs → scripts/sample-server.mjs → in-memory fake data     (localhost:4174, disposable)
       ├─ api.mjs → cloudflare-worker.mjs (SQLite Durable Object) → band-calculator.blazzer.workers.dev   (PRODUCTION accounts)
       └─ cloud-api.mjs → worker.js → Cloudflare D1                     (ChatGPT Sites, RETIRED 2026-09-22: old roster API, unused)
GitHub Pages build (dist/pages): <meta name="band-api"> = the Worker origin (also added to CSP connect-src).
  cloudflare-edge.mjs: CORS for blazzer10200.github.io, SameSite=None;Partitioned cookie, bearer fallback via
  X-PTO-Session (token in sessionStorage). BAND_API= (empty) builds the old calculator-only site (<meta band-standalone>).
  Workers Free = ~10 ms CPU/request → WORKER_HASH scrypt N=4096 (tagged "s4096.8.1$"); untagged = strong local hashes.
  Worker secrets: BAND_KEY (copy in .local/cloudflare-band-key.txt), SETUP_CODE (.local/cloudflare-setup-code.txt).
  Sign-ups never wait on the Owner when SETUP_CODE is set. Hashing runs in the Durable Object (30 s CPU), so strong
  local hashes are fine there. Local accounts moved in 2026-09-23 via scripts/export-accounts.mjs → one-time
  BAND_SEED secret (loaded only into a DB with no users; deleted after). Put the secret BEFORE deploying new code.
  The stash "WIP: Worker backend port" is the abandoned cloud-api.mjs route; superseded, not needed.
```

`api.mjs` is the new backend. On first start against an old database it imports bands, deposits (as counts) and payouts (as cash-outs) once (`meta.import_v1`). `calc-model.js` is shared by the browser and `api.mjs`. The legacy `dev-api.mjs` + `*-model.js` + `finance-*` modules stay on disk only because `cloud-api.mjs`, the legacy tests and `import_v1` tests use them. The browser no longer loads them.

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
                       reads "xN" + weight, cross-checking them (100 g per band, violet 200 g); slots that come back
                       with neither get one retry at a tighter crop. Contrast is stretched per crop (median =
                       background, so grey hotbar slots read) and long dark runs are painted out as slot borders.
                       Unit votes only accept multiples of 10. Unreconcilable slot -> `qty:null`, surfaced as "?" by
                       finance-ui; it never guesses. Grid lines within 2 name-heights are merged — the panel is drawn
                       in perspective and the drift once split one row in two, double-counting every slot on it.
                       Bench: `.local/scan/` (gitignored) — hand-counted TRUTH over 3 screenshots, `pto-scan-harness`
                       in .claude/launch.json serves it on 4180. Run it before and after any scanner change.
quick-math.js          plain calculator panel
panel-layout.js        "Arrange panels" mode: drag/resize the calculator panels, saved per account.
                       Only active at 820px+; x/w are fractions of the workspace width, y/h are pixels.
auth-ui.js             sign in / create account / setup screens, account dialog (display name + security)
security-*.js / security-*.mjs                  MFA, recovery codes, encrypted backups, activity log
LEGACY (production + old tests only, not served to the browser): dev-api.mjs, finance-*.js, model.js,
  access-model.js, hub-model.js, profile-ui.js, member-profile.js, player-picker.js, cloud.js, presence.js
experience.css         current layout overrides (check here first for layout bugs)
calculator.css         calculator styles + the --calc-* tokens, scoped to #main-content (all pages)
app.css                guest pitch, History, Admin
*.css                  domain stylesheets (auth, security, polish); one rule per line, pruned of unused selectors
server.mjs             local dev server, loopback only, port 4173
scripts/dev.ps1        launcher: status/start/restart, PID-guarded
scripts/sample-server.mjs   sample data server (4174)
build*.mjs / client-files.mjs   fingerprinted release build → dist/
db/ drizzle/           schema + generated migrations
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
- LSP works for `.js`/`.mjs` (tsserver). `Grep` honors `.gitignore`, so `.local/` and `dist/` stay out of results.
- Screenshots: `get_page_text` / `read_page` first; screenshot only when layout matters. Use the `data-page`, `data-admin-tab`, `data-finance-quantity` selectors from `docs/DEVELOPMENT.md`.
- Requires Node 24+ (SQLite tests). Installed: v24.19.0.

## Verify

```bash
npm run check          # node --check on every module (syntax)
npm test               # full node --test suite (115 tests, SQLite integration included)
npm run test:api       # the calculator backend (api.mjs)
npm run test:finance   # legacy: money, bills, presence
npm run test:access    # legacy: identity, permissions, approvals, auth
npm run verify:build   # check + Worker build + Pages build + module-graph verify. Builds only, never publishes.
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
- `HANDOFF.md` and `WEBSITE-REVIEW.md` are deliberately untracked (private ops notes). Keep them that way.

## Publish targets (for reference, user-triggered only)

- Frontend: https://blazzer10200.github.io/band-calculator/ (repo `Blazzer10200/band-calculator`, renamed from `pto-roaster`; remote name `github`; local folder is still `projects/pto-roaster`)
- Backend: https://band-calculator.blazzer.workers.dev (the user's Cloudflare account, Workers Free, worker `band-calculator`)
