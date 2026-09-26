# Development shortcuts

Use Node.js 24+. Commands run from the repository root. No dependency install, database replacement, or deployment is hidden in these commands.

| Command | Effect |
| --- | --- |
| `npm run dev:status` | Reports local listener, health, PID, and whether the launcher owns it |
| `npm run dev:start` | Reuses the local server or starts it in a hidden window |
| `npm run dev:restart` | Restarts only a server recorded and verified by this launcher |
| `npm run dev:sample` | Reuses/starts the sample server; data exists only in memory |
| `npm run dev:sample:status` | Reports the sample server's status |
| `npm run test:api` | The calculator backend (`api.mjs`): guests, sign-up, prices, counts, cash-outs, legacy import, restore |
| `npm run test:finance` | Legacy finance tests (old modules kept for the one-time `import_v1`) |
| `npm run test:access` | Legacy access, membership, and authentication tests |
| `npm run verify:build` | Checks syntax, builds Pages, verifies browser modules |

The original `npm run dev` remains available for a foreground server. Normal agent work uses `dev:start`. Logs and launch records live in `.local/dev-PORT.*`. An existing manually started server can be reused, but the launcher refuses to kill it. The launcher's restart guard checks creation time as well as PID to protect against PID reuse.

## Routes and controls

Append these routes to the intended origin; never switch between origins without checking which data is in use.

| Page | Hash | Who | Stable controls |
| --- | --- | --- | --- |
| Calculator | `#/` | Everyone | `[data-page="calculator"]`, `[data-finance-quantity]`, `[data-calc-hero]`, `[data-calc-save]`, `[data-cashout]`, `[data-undo-cashout]`, `[data-remove]`, `[data-arrange]`, `[data-grip]`, `[data-scan-forget]`, `[data-scan-input]`, `[data-shot-open]`, scan viewer `.sv` (`[data-sv-fill]`, `[data-sv-step]`, `[data-sv-row]`, `[data-sv-close]`), guest `[data-action="register"]` / `[data-action="login"]` |
| History | `#/history` | Signed in | `[data-history-range]`, `[data-history-band]`, `[data-history-query]`, `[data-history-csv]` |
| Admin | `#/admin` | Owner | `[data-admin-tab]` (prices, accounts, activity, backups), `#prices-form`, `[data-band-row]`, `[data-toggle-user]` |

Guests get the whole calculator (count, scan, quick math); their count lives on the device for 24 hours and moves into the account they create or sign in to. Signing up is instant, no approval. Only the Owner edits prices; a save sent with an old price revision is refused (409) and the calculator re-totals at the new prices without losing the count.

`[data-arrange]` and `[data-grip]` exist only at 820 px and wider. Cash-out is for every account and resets that account's running total; only the latest cash-out can be undone.

Any other hash (old `#/stash`, `#/settings`, roster, treasury, …) resolves to the calculator. Don't create alternate access routes for testing.

## Isolated sample preview

`scripts/sample-server.mjs` uses an in-memory database and fabricated records. It never opens `.local/pto-dev.sqlite`, imports live credentials, or calls the live API. It binds only to loopback. Restarting it resets the sample data and sessions.

Sample-only usernames: `qa.admin` (Owner) and `qa.existing` (Member), each with two weeks of fabricated counts and cash-outs, plus `qa.fresh` (Member, empty). Their deliberately public test password is `Local-QA-password-123`. This password grants access only to fabricated in-memory records. Normal localhost:4173 uses its existing private accounts.

The normal sample port is 4174. For isolated launcher checks, `powershell -NoProfile -File scripts/dev.ps1 -Action start -Sample -SamplePort 4176` uses a separate loopback port. Inspect exact process identity before stopping a test helper. Existing scripts under `.local/` are historical helpers, not the default workflow.

Project guidance uses the standard [AGENTS.md mechanism](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Keep the guide concise and tied to commands that actually work.
