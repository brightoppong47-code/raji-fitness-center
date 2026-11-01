# RAJI FITNESS CENTER

Firebase Authentication + Cloud Firestore gym management app, built with React/Vite for GitHub Pages.

## Business rules

- Registration: GH₵400, including 30 days of access.
- Renewal: GH₵150 for another 30 days, starting from expiry if still active, otherwise from the renewal date.
- Walk-in: GH₵10; recording payment also checks the visitor in.
- Expired members must renew before check-in. A member can have only one open visit.
- Secretaries may register clients, record payments and check attendance. Admins also manage fees, staff and backup/restore.

## Firebase setup (required before use)

1. Project: `raji-fitness-center`; Email/Password Authentication enabled.
2. Firestore: Standard edition, `(default)` database, production rules.
3. In Firestore → Rules, paste the complete contents of `firestore.rules` and Publish.
4. Firebase Authentication → Settings → Authorized domains: add `brightoppong47-code.github.io`.
5. The owner account is identified by the UID in `src/config.js` and the matching UID in `firestore.rules`. Sign in using that Firebase account, then complete initial setup.
6. In Settings → Staff & access → Create staff login, enter the staff name, email, password and role. Select New login to create the Firebase account or Existing login to link one using its current email and password. The UID is handled automatically. Use Edit access beside an existing staff member to update their name or role. Unapproved accounts cannot read gym records. Passwords are managed by Firebase, never stored in the repository or backups.

The web Firebase configuration is public client configuration. Security is enforced by Firestore rules and Authentication, not by hiding the API key. Never commit service-account credentials or client/payment backups.

## GitHub Pages

Settings → Pages → Source: **GitHub Actions**. Merge the migration branch to `main`; the included Actions workflow builds and deploys `dist/`. The Vite base is `/raji-fitness-center/`.

Expected URL after a successful Pages deployment: `https://brightoppong47-code.github.io/raji-fitness-center/`.

The current Sites-hosted app is independent and is not changed by this migration.

## Data migration and backups

1. Download a backup from the old app.
2. In the Firebase app, sign in as the configured owner and activate the workspace.
3. Settings → Backup & restore → choose the JSON file, review counts and type RESTORE.

Restores validate records, import into a new dataset, and switch the active dataset only after all writes complete. A concurrent new payment causes the switch to be rejected so it is not lost. The previous dataset is retained as a recovery copy. Failed import datasets may remain inactive; only admins can read them. Current Firebase staff access is preserved during restores; staff details from old backups do not automatically create Firebase login accounts. Device themes/photo settings stay on the device. Backups do not contain Firebase passwords.

## Development

Node 22.13+:

```sh
npm install
npm run dev
npm run build
```

The Firebase modular web SDK is pinned to 12.0.0 and loaded from Google’s official CDN. Internet access to Firebase/Google endpoints is required. The app refreshes records every 30 seconds and immediately after saves. Payments/attendance use Firestore transactions, and secretaries cannot rewrite or delete payment history under the provided rules.

## Limits

JSON restores are limited to 20 MB. Client photos are limited to 250 KB. After opening and signing in online once on a device, the app can load cached records offline. Registrations, renewals, walk-ins and attendance are stored in an account-scoped IndexedDB outbox and synchronized while the app is open after reconnecting. Pending entries are excluded from confirmed totals. Device-recorded times are retained; the server separately records when entries sync. Entries older than seven days, fee conflicts and changes caused by a database restore require review. Sign-out clears cached records and is blocked until pending entries are synced or exported and removed. Initial setup, staff access, fee settings, backups and restores require internet. JSON exports cover app records, not Firebase Authentication passwords or provider configuration. High Contrast intentionally hides the page watermark. Theme/visibility choices are device preferences.

## Validation

The actual Firebase adapter was exercised against the Firestore emulator with the supplied security rules. Tests cover owner setup, secretary workflows, unauthorized access, direct fee/role/payment tampering, backup validation, restore and recovery. The test harness is in `tests/firestore.mjs`. It requires Firebase SDK 12.0.0, rules-unit-testing 5.0.0 and a compatible Firebase CLI/Java installation; `RAJI_TEST_DEPS` can point to an external test package.json. `emulator.test.json` uses only the demo project, never production.

## Offline update setup

Republish the updated `firestore.rules` before deploying the offline update. Existing online clients remain compatible. The new rules accept captured event timestamps within a seven-day window, preserve server commit timestamps, and still protect secretary fees/roles/history.

The service worker precaches the built app, gym imagery and the three pinned Firebase SDK modules. It never caches Firestore/API requests. Keep the first online session open until Settings → Offline & sync says files are ready. Browsers may evict local storage; download regular JSON backups while online. Synchronization runs while the app is open, using Web Locks where available to coordinate multiple tabs. The same queued operation ID is checked transactionally so retries cannot create a second payment.

Tests: `npm run build && node tests/shell.mjs` validates the offline shell. The emulator integration suite also tests durable outbox storage using `fake-indexeddb@6`, delayed event dates, idempotency, fee conflicts, seven-day limits and reconnect sync.

Staff provisioning uses a separate in-memory Firebase Auth instance, so the admin remains signed in. Passwords are passed only to Firebase Authentication and are never stored in Firestore, backups or the offline outbox. New accounts require a password of at least eight characters and must satisfy the Firebase project policy. Staff can use Forgot password on the login screen to reset their own password. Provisioning requires internet.
