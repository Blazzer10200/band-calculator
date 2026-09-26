# Band Calculator project workflow

Keep work focused on the user's current request. This file maps the project; it does not authorize publishing or changing live data.

## Start here

- Work from this repository. Read the current-status and next-action sections of HANDOFF.md when present; check dated claims against the current diff before using them as current behavior. Do not replay completed work.
- Run `git status --short` once. Preserve the user's existing edits.
- `npm run dev:status` checks the local preview at http://127.0.0.1:4173/.
- `npm run dev:start` reuses a healthy running preview or starts it hidden. It does not reset the database or login.
- `npm run dev:sample` reuses/starts a separate sample preview at http://127.0.0.1:4174/. Only this preview is for test counts, cash-outs, price edits, and account changes.
- Static browser files are served from disk: reload after changing them. Server imports need a restart. `npm run dev:restart` only stops a process whose PID, creation time, and script match the launcher's private record; inspect older manually started processes explicitly.

## Find the right code

| Concern | Start with |
| --- | --- |
| Routes, header, page mounting | app.js: routeNames, followRoute, render |
| Calculator screen (counts, scanner, quick math) | calculator-ui.js: mountCalculator; band-scan.js; quick-math.js |
| Dragging and resizing the calculator panels | panel-layout.js: createPanelLayout (820px and wider only) |
| History, Admin | history-ui.js: mountHistory; admin-ui.js: mountAdmin |
| Money and day rules (browser + server) | calc-model.js |
| Sign in, account dialog, two-factor, Activity, Backups | auth-ui.js, security-ui.js |
| Backend (local, sample and Cloudflare Worker) | api.mjs; cloudflare-worker.mjs + cloudflare-edge.mjs |
| Look and feel ("Ledger") | tokens.css (colors, type, radii), then styles, polish, experience (motion), auth, security, calculator, app |
| Browser asset/build boundary | client-files.mjs, build-client.mjs |
| Legacy (old tests and the one-time `import_v1` only) | dev-api.mjs, finance-*.js, model.js, access-model.js, profile-ui.js |

Search anchored symbols with `rg -n`; avoid dumping minified CSS or whole large modules. Inspect both API adapters when changing endpoint behavior. Shared business logic belongs in the shared modules.

## Browser work

- Resolve tabs by exact origin each turn when a handle is stale; tab IDs change. Reuse the selected browser and existing matching tabs. Follow the browser tool's documented API.
- 4173 is the user's separate local database; 4174 is disposable sample data. Neither is production. Do not copy production data to make a screenshot.
- Preserve the user's signed-in session and unfinished forms. Do not restart a healthy server or sign the user out merely to check another role; use the sample preview.
- Use named controls or the existing `data-page`, `data-admin-tab`, and `data-finance-quantity` attributes. Batch independent inspection; observe state after actions. See docs/DEVELOPMENT.md for routes and sample accounts.
- Login credentials are private. Never print password/token files or include their contents in tool output, commands, docs, or screenshots. Use the authorized browser form; do not add a login bypass.
- Verify affected routes once at the sizes relevant to the change. Measure overflow against `document.documentElement.clientWidth`. Reset temporary viewport overrides and retain the user's preview tab.

## Verification without repetition

- CSS/copy: inspect the affected page and phone layout; `git diff --check`. Do not rerun unrelated backend tests.
- JavaScript changes: `npm run check` and the affected behavior below.
- Money, bills, or presence: `npm run test:finance`.
- Identity, permissions, approvals: `npm run test:access`.
- Storage/security/API changes spanning both adapters: `npm test`.
- Before publication or a build-boundary change: `npm run verify:build`. This builds and verifies locally; it does not publish.
- Reuse passed checks when their inputs have not changed. Repeat after a relevant change, failure, or unresolved concern. Report the actual scope; focused tests are not the full suite.
- Keep the final report about visible behavior, verification, and remaining limitations. Do not substitute a plan or a checklist for the requested work.
