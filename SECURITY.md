# Band Calculator security

Both the loopback development server and hosted Worker enforce application login, approval, roles and two-factor policies. GitHub Pages serves only allowlisted public assets; private accounts and records remain in the backend.

## Owner setup

1. Open **Review security** or the account menu's **Account settings**.
2. Choose **Set up two-factor**, confirm your current password, scan the locally generated QR code in an authenticator, and confirm a fresh six-digit code.
3. Save the recovery codes in a private password manager or another secure location. They are shown once.
4. Open **Admin protection**, enter your password and a fresh authenticator code, and choose **Require two-factor for admins**. The Owner and roles with Manage on People & roles must then enroll before opening workspace data. The requirement cannot be disabled through the UI.

Two-factor is not enabled automatically on a real user's behalf. Existing local accounts keep their passwords and access until the Owner enables the admin requirement. Non-admin accounts can enroll voluntarily. A stolen administrator session is still sensitive: only grant global role administration to trusted people.

## Authentication and recovery

- Passwords use salted scrypt. Login attempts are reserved in SQLite before password work; account IDs unify username/email aliases, a separate bucket uses the socket's client address, and expensive password operations are bounded. Request headers cannot supply a trusted client address. Limits survive server restarts and expire after their windows.
- RFC 6238 TOTP uses 30-second periods and a one-step clock tolerance. Accepted codes cannot be replayed. QR generation occurs on the server without sending secrets to a third party. Authenticator secrets are AES-256-GCM encrypted with the private local key.
- Password-only login creates a five-minute challenge when MFA is enabled. It does not create an authenticated session. Password changes, enrollment, account recovery, and explicit session revocation invalidate other sessions/challenges as applicable.
- **Trouble signing in?** accepts a username, recovery code, and replacement password. Recovery codes contain 96 bits of randomness and only account-bound hashes are stored. A successful recovery expires the entire code set, removes the old authenticator, and signs out all devices. Approval status and roles do not change. Admins must re-enroll when the admin policy is enabled.
- Regenerating recovery codes, changing passwords, requiring admin MFA, signing out other sessions, and exporting full backups require password confirmation and a fresh authenticator code when enrolled. There is no email reset service, universal reset password, or admin-readable password.
- Sessions use random tokens stored as hashes with HttpOnly cookies. Keep me signed in is checked by default and uses a 30-day server expiry and persistent cookie; unchecking it uses a browser-session cookie with a 12-hour server expiry. Development is HTTP on loopback only. Hosted cookies use Secure; same-origin uses SameSite=Strict and GitHub Pages uses SameSite=None; Partitioned with credentialed requests allowed only from the exact Pages origin. The current-page bearer fallback stays only in memory. Passwords and tokens are never stored in URLs/localStorage/sessionStorage. MFA challenges preserve the chosen duration without authenticating until verification. Logout/revocation and account recovery remain effective, and restored backups contain no sessions. The local development server must not be exposed through a public tunnel.

## Activity and backups

Account-linked finances use dedicated server endpoints. My stash View permits only the signed-in account's submissions and personal history; Treasury View exposes the gang queue, and Treasury Manage permits payout/rejection and weekly-payment confirmations. Server-selected rates are frozen per deposit. A payout must match both the reviewed entry IDs and amount, and non-Owner managers need another manager to confirm their own payout. The authenticated Owner may confirm their own payout; request-body fields cannot grant this exception. Unique request IDs and atomic commits prevent duplicate payment records. Paid/rejected entries retain actor and time; generic ledger writes cannot replace finance history.

Roster removal requires Roster Manage and a current workspace revision. It does not revoke the person's website access. Account deletion requires People & roles Manage, the exact username, and current account/workspace revisions; Owner/self deletion and deletion with pending deposits are blocked. The atomic deletion removes the user, linked roster profile, sessions, MFA challenges, authenticator record and recovery codes. Historical finance records and audit events retain their saved identities; historical backups remain unchanged.

Full encrypted backups include account-linked deposits, payouts and weekly bills. The ordinary Settings JSON export covers roster and earlier ledger records; its restore preserves current account-linked finances.

**People & roles → Activity** is limited to account administrators. It displays actor, time, account/workspace events, and access-change summaries, with pagination. New audit records retain the actor name after deletion. Existing records without a stored actor name cannot reconstruct a deleted identity. Stored workspace snapshots and security details are not returned in this activity feed. This local database is not a tamper-proof external audit service.

The server creates at most one encrypted daily snapshot under `.local/backups/` at startup or an hourly check while running. The Backups tab reports the snapshot time or an error. No automatic deletion/retention cleanup is configured. These snapshots require the original `.local/security.key`; keep that key private and backed up separately. Snapshots on the same drive do not protect against losing the computer.

**People & roles → Backups** lets the Owner download a complete encrypted backup protected by a separate 15–128-character passphrase. It contains accounts, password hashes, encrypted MFA configuration and its key, recovery-code hashes, roles, security policy, workspace, and activity. Sessions, pending MFA enrollment secrets, challenges, and rate-limit buckets are excluded. The workspace includes account-linked deposits, payouts, reversals, cashbook, calendar, availability, private notes, and notification read state. A roster/earlier-ledger JSON download under Settings is **not** a full backup.

`restore-backup.mjs` validates and restores only into a **new directory**, never the live workspace. For a downloaded `.ptobak`, the operator supplies `PTO_BACKUP_PASSWORD` privately in the environment and runs `node restore-backup.mjs BACKUP_FILE NEW_DIRECTORY`. For a local daily snapshot, supply `PTO_BACKUP_KEY_FILE` pointing to the original key instead. Clear temporary environment secrets afterward. The restored directory contains a database/key pair, without signed-in sessions. Verify the copy before an explicitly authorized switchover. A forgotten backup passphrase cannot be recovered.

## Hosted operation

An operator can recover an existing Owner password through the private `PTO_OWNER_PASSWORD_RESET` deployment setting. It targets the exact Owner ID, username, and previous password digest, expires within an hour, revokes the Owner's old sessions, and records an audit event. It never accepts reset instructions from HTTP input and cannot replay after the password changes. Clear the setting to an empty value and redeploy after a verified reset.

- The Worker stores account/workspace state in D1 using an atomic revision comparison. Competing mutations rerun against current permissions before committing; state, audit records and the daily encrypted snapshot commit together. Per-account and Cloudflare client-IP limits are shared in D1. The document is capped at 1.4 MB; normalize storage before approaching this limit.
- `PTO_SECURITY_KEY` is a private runtime secret. The one-time `/api/operator/migrate` route additionally requires `PTO_MIGRATION_TOKEN` and rejects all imports after initialization. The public cannot claim the Owner account. Remove the migration secret after the verified import.
- Legacy hosted ledger tables remain preserved for operator recovery and are no longer exposed through the API. Hosted daily snapshots are encrypted, chunked in D1, and created on the first state change each UTC day; their status reports the saved UTC day; they are not an independent off-provider backup. Download a passphrase-protected full backup to a separate location.
- GitHub Pages CORS is restricted to the configured GitHub origin. Public pages have a CSP meta policy; hosted responses add frame protection and no-store API headers. No ChatGPT login is involved.
- Complete Owner MFA/recovery setup, require admin MFA, and configure off-device encrypted backups plus a tested restoration procedure.
- Review signup abuse controls against real traffic and verify recovery, session revocation, audit access, and security headers on the final domain. Run the security regression tests and dependency audit.

Implementation references: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). The TOTP tests include the RFC's SHA-1 test vectors.

## Drafts and role safety

Stash draft quantities and notes are namespaced to the signed-in account in device storage for 24 hours. Submitting, discarding, signing out, or detecting loss of authentication clears drafts. Passwords and session tokens are not stored there. This convenience is device-local; shared-device users should sign out when finished.

Account access changes require the current access revision. A stale form cannot undo a newer disable or role change. True no-op saves preserve sessions; actual changes revoke them. Menu category moves preserve previous effective page grants. Private leadership notes are enforced by the server, separately from shared roster notes.

Owner-only reversal and reconciliation controls retain the original finance record and record who corrected it and why. Partial payouts cannot exceed outstanding amounts. Payouts validate the exact reviewed deposit set and balance; idempotent request IDs prevent duplicate payment on retries. Optional deposit verification is a separate check from payment confirmation.
