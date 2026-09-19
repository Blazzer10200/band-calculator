# Development shortcuts

Use Node.js 24+. Commands run from the repository root. No dependency install, database replacement, or deployment is hidden in these commands.

| Command | Effect |
| --- | --- |
| `npm run dev:status` | Reports local listener, health, PID, and whether the launcher owns it |
| `npm run dev:start` | Reuses the local server or starts it in a hidden window |
| `npm run dev:restart` | Restarts only a server recorded and verified by this launcher |
| `npm run dev:sample` | Reuses/starts the sample server; data exists only in memory |
| `npm run dev:sample:status` | Reports the sample server's status |
| `npm run test:finance` | Finance, preservation, and presence regression tests |
| `npm run test:access` | Access, membership, and authentication regression tests |
| `npm run verify:build` | Checks syntax, builds Worker and Pages, verifies browser modules |

The original `npm run dev` remains available for a foreground server. Normal agent work uses `dev:start`. Logs and launch records live in `.local/dev-PORT.*`. An existing manually started server can be reused, but the launcher refuses to kill it. The launcher's restart guard checks creation time as well as PID to protect against PID reuse.

## Routes and controls

Append these routes to the intended origin; never switch between origins without checking which data is in use.

| Page | Hash | Stable controls |
| --- | --- | --- |
| Calculator | `#/stash` | `.finance-main-nav [data-page="overview"]`, `[data-finance-quantity]`, `[data-calc-hero]` |
| Accounts & access | `#/admin` | `.admin-nav [data-page="access"]`, `[data-access-tab]` |
| Join requests | `#/requests` | `.admin-nav [data-page="requests"]` |
| Settings & backups | `#/settings` | `.admin-nav [data-page="settings"]`, `#settings-form`, `[data-setting-band]` |

Old home/calendar/update/roster/treasury/contacts bookmarks resolve to the calculator (or the first allowed admin page). `#/people` remains an alias for account administration. Permissions determine which controls appear; don't create alternate access routes for testing.

## Isolated sample preview

`scripts/sample-server.mjs` uses an in-memory database and fabricated records. It never opens `.local/pto-dev.sqlite`, imports live credentials, or calls the live API. It binds only to loopback. Restarting it resets the sample data and sessions.

Sample-only usernames: `qa.admin` (Owner), `qa.existing` (Member), `qa.treasurer` (Treasurer), and `qa.applicant` (pending approval). Their deliberately public test password is `Local-QA-password-123`. This password grants access only to fabricated in-memory records. Normal localhost:4173 uses its existing private accounts.

The normal sample port is 4174. For isolated launcher checks, `powershell -NoProfile -File scripts/dev.ps1 -Action start -Sample -SamplePort 4176` uses a separate loopback port. Inspect exact process identity before stopping a test helper. Existing scripts under `.local/` are historical helpers, not the default workflow.

Project guidance uses the standard [AGENTS.md mechanism](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Keep the guide concise and tied to commands that actually work.
