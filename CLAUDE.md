# PTO Roaster — Claude project reference

`AGENTS.md` is the Codex/ChatGPT-side rulebook this project was born with; this file is the Claude-side one. Both describe the same repo. Read `HANDOFF.md` before starting. Do not replay completed work.

## What this is

Private FiveM band calculator: count bands at configured prices, scan inventory screenshots on-device (vendored Tesseract), save counts, plus login/approvals/roles, MFA, and encrypted backups. Roster and Treasury were stripped from the UI on 2026-09-19; the backend still serves their endpoints and keeps the data. Plain ES modules, no framework, no bundler in dev.

```text
Browser (index.html + *.js/*.css, served from disk)
  └─ api-config.js picks the backend by hostname
       ├─ dev-api.mjs  → server.mjs  → SQLite  .local/pto-dev.sqlite   (localhost:4173, YOUR private data)
       ├─ scripts/sample-server.mjs → in-memory fake data              (localhost:4174, disposable)
       └─ cloud-api.mjs → worker.js  → Cloudflare D1                    (production, via ChatGPT Sites)
```

Shared business logic lives in `*-model.js`. Both API adapters (`dev-api.mjs`, `cloud-api.mjs`) must agree when an endpoint changes.

## Map

```text
app.js                 routes (routeNames, followRoute, render), header, page mounting
finance-ui.js          Calculator screen (mountFinance, mode 'bands'): counts, scanner, quick math
band-scan.js           screenshot OCR (ocr-engine/ocr-worker/ocr-core + eng.traineddata.gz, vendored Tesseract).
                       Pass 1 finds "<Color> Stack" names on the whole image; pass 2 crops each slot, stretches
                       contrast per row (median = background, so grey hotbar slots read), reads "xN" + weight and
                       cross-checks them (100 g per band, violet 200 g). Unit votes only accept multiples of 10.
quick-math.js          plain calculator panel
finance-model.js       money rules, receipts, integer cents
finance-api.js         finance endpoints shared by both adapters
profile-ui.js / member-profile.js               identity editing (used by auth-ui)
auth-ui.js / access-model.js                    login, approvals, roles
presence.js                                     server-side presence (no UI anymore)
security-*.js / security-*.mjs                  MFA, recovery codes, encrypted backups
experience.css         current layout overrides (check here first for layout bugs)
calculator.css         calculator screen styles
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
- `pto-sample` → http://127.0.0.1:4174 — fake in-memory data. Use this for test deposits, payouts, approvals, removals. Accounts in `docs/DEVELOPMENT.md` (`qa.admin`, `qa.treasurer`, `qa.existing`, `qa.applicant`).

Static files are served from disk: reload after editing browser code. Server imports (`*.mjs`) need a restart. Check ports before spawning: `npm run dev:status` / `npm run dev:sample:status`. Never kill a listener you didn't start.

## Claude tooling notes

- No Svelte/Python/Rust here, so `/check` and `/test` have nothing to detect. Use the npm scripts below directly.
- LSP works for `.js`/`.mjs` (tsserver). `Grep` honors `.gitignore`, so `.local/` and `dist/` stay out of results.
- Screenshots: `get_page_text` / `read_page` first; screenshot only when layout matters. Use the `data-page`, `data-access-tab`, `data-finance-quantity` selectors from `docs/DEVELOPMENT.md`.
- Requires Node 24+ (SQLite tests). Installed: v24.19.0.

## Verify

```bash
npm run check          # node --check on every module (syntax)
npm test               # full node --test suite (86 tests, SQLite integration included)
npm run test:finance   # money, bills, presence
npm run test:access    # identity, permissions, approvals, auth
npm run verify:build   # check + Worker build + Pages build + module-graph verify. Builds only, never publishes.
```

CSS/copy-only change: inspect the page at phone + desktop width, then `git diff --check`. JS change: `npm run check` + the focused suite for that domain. Anything touching both API adapters or storage: full `npm test`.

## Rules that bite

- **Never publish.** GitHub Pages deploys only through manual dispatch of `.github/workflows/pages.yml`. Backend deploys through ChatGPT Sites. Both are user-initiated. Backend before frontend when endpoints change.
- **Never add a login bypass, dev-only credential, or test route.** Use the sample server for other roles.
- **4173 is real data.** No test transactions there. Don't restart it or sign the user out just to check something.
- **No secrets in the repo.** `.local/` holds credentials and baselines. Don't print, copy, or screenshot them.
- Money is integer cents. Price snapshots on deposits are immutable. Owner may confirm own payout; other managers need a second manager.
- Deploy only files named in `release.json` from a fresh staging dir.
- `HANDOFF.md` and `WEBSITE-REVIEW.md` are deliberately untracked (private ops notes). Keep them that way.

## Publish targets (for reference, user-triggered only)

- Frontend: https://blazzer10200.github.io/pto-roaster/ (repo `Blazzer10200/pto-roaster`, remote name `github`)
- Backend: ChatGPT Sites Worker, see `HANDOFF.md` for the current deployment ids
