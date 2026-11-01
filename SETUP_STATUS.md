# Migration checklist

- [x] Firebase web configuration received
- [x] Owner UID supplied
- [x] Email/Password provider enabled (user confirmed)
- [x] Default Firestore database created (user confirmed)
- [x] GitHub Pages domain authorized (user confirmed)
- [x] GitHub repository write access verified
- [x] Publish initial Firestore rules in Firebase Console (user confirmed)
- [x] Configure GitHub Pages source as GitHub Actions
- [x] Merge migration branch and verify successful Pages deployment
- [ ] Sign in as owner and complete setup
- [ ] Import old backup if there are existing records
- [ ] Verify registration, renewal, walk-in and check-in/out on the live Firebase project

No live client records have been migrated by the code authoring process. Existing Sites-hosted data remains in place.

## Offline update

- [x] Offline shell and account-scoped cache/outbox implemented
- [x] Reconnect, idempotency, timestamp, conflict and access tests passed in emulator
- [x] Offline shell cache tests and production build passed
- [ ] Republish the updated firestore.rules (accepts bounded offline event times)
- [ ] Merge offline-support and verify deployment
- [ ] Open the app online once per device until Offline files are ready
