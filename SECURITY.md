# Band Calculator security

The calculator needs no account. Counting, quick math and screenshot scanning all run in the browser, and a scanned screenshot is never uploaded. Accounts exist only to save counts. Every rule below is enforced by the backend, `api.mjs`, which runs either in the local server (`server.mjs`) or in the hosted Cloudflare Worker. GitHub Pages serves only the public files listed in `release.json`.

## Who can do what

| Who | Can |
|---|---|
| Guest | Use the calculator, scanner and quick math. Nothing is saved except a draft in this browser. |
| Member | Save counts to their own running total, cash out, see their own History, change their display name and password, set up two-factor. |
| Owner | Everything a member can, plus edit prices, disable or re-enable accounts, read Activity and download encrypted backups. |

The server checks the signed-in account on every request. A member only ever sees and changes their own counts. Owner tools answer 403 to everyone else.

## Signing up and signing in

- Anyone can create an account, and it works straight away. Usernames are 3–32 letters, numbers, dots, underscores or hyphens. Passwords are 12–128 characters.
- A new local database starts empty. Its first account must be the Owner, made on the setup screen, and sign-ups are refused until then. The hosted Worker guards Owner setup with the private `SETUP_CODE` secret instead, so sign-ups there never wait on it.
- Passwords are stored only as salted scrypt hashes. New passwords on the Worker use a lighter setting (N=4096, tagged `s4096.8.1$`) to fit the Workers Free CPU limit; older, stronger hashes still verify.
- Limits, per 10 minutes: 8 sign-in attempts per account, 120 per network address, 5 Owner-setup attempts and 10 sign-ups per address. At most four password checks run at once. Saving counts is limited to 120 a minute per account.
- An unknown username costs the same password work as a real one, and a wrong password, unknown user and disabled account all get the same message. Failed sign-ins on real accounts are recorded in Activity.

## Sessions

- A session is a random 32-byte token. The server keeps only its hash.
- **Keep me signed in** is on by default: the session lasts 30 days and survives closing the browser. With it off, the session ends after 12 hours or when the browser closes.
- Locally the cookie is `HttpOnly` and `SameSite=Strict`, over plain HTTP on the loopback address only. Never expose the local server through a public tunnel.
- On the hosted site, the page (GitHub Pages) and the API (the Worker) are different sites. The Worker's cookie is `__Host-band_session`: `HttpOnly`, `Secure`, `SameSite=None`, `Partitioned`. CORS answers only `https://blazzer10200.github.io`.
- Browsers that block that cookie still work. The Worker also returns the token in an `X-PTO-Session` header; the page keeps it in `sessionStorage` (this tab only, gone when the tab closes) and sends it back as `Authorization: Bearer`. It is cleared on sign-out and on any 401.
- Every request that changes something must come from the site's own origin and carry `X-Bandbook-Request: 1`, which stops cross-site form posts.
- Changing the password needs the current password, plus a fresh authenticator code when two-factor is on, and signs out every other device. **Sign out other devices** does the same without a password change.

## Two-factor and recovery

- Two-factor is optional for members. It is TOTP per RFC 6238: SHA-1, six digits, 30-second steps, one step of clock drift either way. An accepted code can't be used again.
- The QR code is drawn by the server, so the secret never goes to a third party. Authenticator secrets are stored encrypted (AES-256-GCM) with the server key: `.local/security.key` locally, the `BAND_KEY` secret on the Worker.
- With two-factor on, a correct password only opens a five-minute challenge. No session exists until the code is entered.
- Turning two-factor on shows eight recovery codes once. Each has 96 random bits and only its hash is stored. It also signs out other devices.
- **Trouble signing in?** takes a username, one recovery code and a new password. It uses up the whole set of codes, removes the authenticator and signs out every device. There is no email reset, no master password, and no one can read a password.
- These need a fresh password, plus an authenticator code when two-factor is on: changing the password, new recovery codes, signing out other devices, the Owner requirement below, and downloading a backup.

### Owner setup

1. Open the account menu → **Account settings** and set up two-factor. Save the recovery codes somewhere private, such as a password manager.
2. Turn on **Require two-factor for the Owner**. It needs two-factor and recovery codes to be set up first, and there is no switch to turn it back off. While it is on, an Owner without two-factor can only sign in, sign out or change their password until they set it up.

## Owner tools

- **Prices.** Only the Owner changes band prices (Admin → Prices). Each save carries the prices revision it started from, and a stale save gets a 409 instead of overwriting newer prices. Every saved count keeps the band name, color and price it was saved with, so a price change never rewrites history.
- **Accounts.** The Owner can disable or re-enable any other account. Disabling signs it out everywhere and blocks sign-in; its counts are kept. The Owner's own row is protected.
- **Activity.** Who did what and when: accounts created, sign-ins and failed sign-ins, password and name changes, two-factor changes, recovery, price edits (before and after), accounts disabled or enabled, backups downloaded. It lives in the same database, so it is a record, not a tamper-proof external log.

## Backups

- **Admin → Backups** downloads a full encrypted backup protected by its own 15–128 character passphrase (scrypt, then AES-256-GCM). It holds accounts and password hashes, two-factor settings with the key that opens them, recovery-code hashes, the security policy, prices, counts, cash-outs and Activity. Sessions and half-finished two-factor setups are left out. A forgotten passphrase can't be recovered.
- The local server also writes one encrypted snapshot a day to `.local/backups/` (checked at startup and every hour), sealed with `.local/security.key`. Nothing deletes old snapshots. They are useless without that key, and they sit on the same drive, so keep the key and a downloaded backup somewhere else too. The hosted Worker makes no automatic snapshots; download backups from the Backups tab.
- `restore-backup.mjs` never touches live data. It restores into a directory that must not exist yet, and checks the whole backup in memory before writing anything:

  ```bash
  node restore-backup.mjs BACKUP_FILE NEW_DIRECTORY
  ```

  Put the passphrase in `PTO_BACKUP_PASSWORD` for a downloaded backup, or point `PTO_BACKUP_KEY_FILE` at the original key for a daily snapshot, and clear it afterwards. It restores calculator backups (`pto-calc-backup`) and ones from the old roster app (`pto-full-backup`). The new directory gets `pto-dev.sqlite` and `security.key`, with nobody signed in. Check the copy before switching to it.

## In this browser

- Tile counts that aren't saved yet are kept as a draft in `localStorage` for 24 hours, separately for each account and for guests, so a reload doesn't lose them. A guest draft moves into the account on sign-in. Saving or discarding clears it, and signing out clears every draft in this browser. Passwords and session tokens are never stored there.
- The panel layout, view preferences and names you've taught the scanner are kept in this browser too.
- On a shared computer, sign out when you're done.

## Hosted operation

- The Worker (`cloudflare-worker.mjs`) runs the same `api.mjs` inside one SQLite Durable Object. `BAND_KEY` and `SETUP_CODE` are Worker secrets and never go in the repo.
- The local server sends the security headers (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`). The Pages site carries its CSP in a `<meta>` tag whose `connect-src` includes the Worker. API responses are `Cache-Control: no-store`.
- Pages publishes only the files in `release.json`, and the workflow checks the module graph (`verify-release.mjs`) before uploading. Both deploys are manual; when API endpoints change, deploy the Worker first.
- Owner checklist: two-factor on, recovery codes stored, Owner requirement on, an encrypted backup kept off this computer with its passphrase stored separately, and a test restore now and then.

References: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [OWASP MFA cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). The TOTP tests include the RFC's SHA-1 test vectors.
