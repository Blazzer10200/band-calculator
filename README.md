# Band Calculator

A free FiveM band calculator: https://blazzer10200.github.io/band-calculator/

Count your bands, or paste a screenshot of your inventory, and see what they're worth. No account needed; everything runs in your browser and nothing is uploaded.

The GitHub Pages site is the calculator on its own. The same code also has an account mode (a running total, cash-outs, History, and an Owner-only Admin page), but that needs the Node server in this repo, so it only runs locally for now.

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

The site is GitHub Pages, published only by manually running the **Publish Band Calculator** workflow. `npm run build:pages` writes fingerprinted browser files to `dist/pages` with a `release.json` manifest, and marks `index.html` with `<meta name="band-standalone">`. With that tag the app never calls a server: it uses the built-in prices (`DEFAULT_BANDS` in `calc-model.js`) and hides the account buttons. To change a price on the live site, edit `DEFAULT_BANDS` and publish again.

The older Cloudflare Worker backend (`worker.js`, `cloud-api.mjs`) is no longer used by the site and still serves the retired roster API.

Older versions of this project (the PTO roster and treasury app) are described in [RELEASE-NOTES.md](./RELEASE-NOTES.md) and the git history.
