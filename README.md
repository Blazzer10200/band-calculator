# Band Calculator

A free FiveM band calculator: https://blazzer10200.github.io/band-calculator/

Count your bands, or paste a screenshot of your inventory, and see what they're worth. No account needed: counting and scanning run in your browser and nothing is uploaded.

A free account adds a running total, cash-outs, History, and (for the Owner) an Admin page. Accounts live on a Cloudflare Worker; see Publishing.

## What's in it

**Count bands.** Step each band up or type the number; the total updates as you go.

**Scan a screenshot.** Snip your inventory (Win+Shift+S), then paste or drop the image. It's read on your own device with a vendored copy of Tesseract (Apache-2.0); nothing is uploaded. Each slot's `xN` count is checked against its weight (100 g per band, Violet 200 g, Loose change 50 g). A count the weight doesn't agree with is flagged "double-check this one", and a slot it can't read comes back as "?" instead of a guess.

**Quick math.** A plain calculator for odd sums. Nothing typed there is saved.

**History** (signed in). Today / this week / all-time totals, a 30-day chart, per-band totals, cash-outs, and a CSV export.

**Admin** (Owner only). Band prices, accounts, activity, and encrypted backups. Price changes apply to new counts only; saved counts keep the price they were entered at.

Money is stored in integer cents. Days follow America/Chicago and weeks start on Thursday.

## Run locally

Requires Node.js 24 or newer. Run `npm ci` once.

```sh
npm run dev          # your local database, http://127.0.0.1:4173
npm run dev:sample   # fake in-memory data, http://127.0.0.1:4174
```

Routes, selectors, and the sample accounts are in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md). Security setup, MFA, and backup restore are in [SECURITY.md](./SECURITY.md).

```sh
npm run check          # syntax check every module
npm test               # full test suite
npm run verify:build   # check + Worker build + Pages build. Builds only, never publishes.
```

## Publishing

Two parts, each deployed by hand.

**Site: GitHub Pages.** Published only by manually running the **Publish Band Calculator** workflow. `npm run build:pages` writes fingerprinted browser files to `dist/pages` with a `release.json` manifest. It points the site at the accounts server with `<meta name="band-api">` and adds that origin to the page's CSP `connect-src`. Build with `BAND_API=` (empty) for a calculator-only site that never calls a server (`<meta name="band-standalone">`, prices from `DEFAULT_BANDS` in `calc-model.js`).

**Accounts: Cloudflare Worker** at https://band-calculator.blazzer.workers.dev (Workers Free). `cloudflare-worker.mjs` runs the same `api.mjs` as the local server inside one SQLite Durable Object. `cloudflare-edge.mjs` lets the Pages origin call it: CORS, a cross-site `SameSite=None; Partitioned` session cookie, and a bearer-token fallback (`X-PTO-Session`) for browsers that block it. Prices are edited by the Owner on the Admin page, not in code.

```sh
npm run cf:dev       # the Worker in the real runtime, http://127.0.0.1:8787 (secrets from .dev.vars, gitignored)
npm run cf:deploy    # wrangler deploy; needs `wrangler login`
```

Worker secrets: `BAND_KEY` (32 random bytes, base64; encrypts 2FA secrets; a private copy is in `.local/`, so never rotate it casually) and `SETUP_CODE` (needed once to create the Owner account). On Workers Free each request gets about 10 ms of CPU, so Worker passwords use lighter scrypt settings (`WORKER_HASH`); the stronger local hashes still verify. The Owner's encrypted backup download may exceed that budget.

Deploy the Worker before the site when endpoints change. The older ChatGPT Sites backend (`worker.js`, `cloud-api.mjs`) is retired and unused.

Older versions of this project (the PTO roster and treasury app) are described in [RELEASE-NOTES.md](./RELEASE-NOTES.md) and the git history.
