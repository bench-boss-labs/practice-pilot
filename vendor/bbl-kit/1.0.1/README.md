# Bench Boss Labs kit

*Better Tools. Bigger Games.*

The shared pieces every Bench Boss Labs app is built from: brand styles, the update banner and release notes, the Help screen, offline support and on-device storage. Rules for using them are in the Bench Boss Labs Product Standards; the look is documented in the Bench Boss Labs design system.

## How an app uses the kit

Apps **copy** a fixed version of the kit; they never load it from this repo live. Changing the kit therefore changes no app until that app is deliberately upgraded.

1. Copy this repo's files (without `tests/`, `node_modules/`) into the app at `vendor/bbl-kit/<version>/`.
2. Record the version in the app's `bbl-kit.json`: `{ "version": "1.0.1" }`.
3. Upgrading: copy the new version beside the old one, point the app at it, run the app's tests, mention "Updated to Bench Boss Labs kit 1.1.0" in its release notes, then delete the old folder.

**Before changing the kit**, list every app and the kit version it uses (the App portfolio table in the Product Standards), say what the change would mean for each, and get Cristian's OK.

## What's inside (1.0.1)

| File | Gives an app |
| --- | --- |
| `bbl-tokens.css` | Colours (dark default, `data-theme="light"`), type (`.t-title`, `.t-body`, …), spacing, radii, tap sizes |
| `bbl-components.css` | `.topbar`, `.btn`, `.card`, `.field`, `.pill`, `.chip`, `.banner`, `.toast`, `.dialog`, What's new |
| `bbl-updates.js` | Version checks, quiet releases, the update banner, What's new, App history, changelog text |
| `bbl-help.js` | The standard Help screen |
| `bbl-offline.js` | Service worker registration, applying an update, online status, one tab at a time |
| `bbl-sw.js` | The service worker: fresh files with a 4-second fallback, safe from rink Wi-Fi sign-in pages |
| `bbl-install.js` | The Install section every app shows in Settings › This device |
| `bbl-store.js` | IndexedDB storage with schema versions, upgrades with a backup first, Backup and Restore |
| `scripts/stamp.mjs` | Writes the version into the app's files and builds `CHANGELOG.md` |
| `brand/bbl-symbol.svg` | The Bench Boss Labs symbol |

Google sign-in and Drive helpers (`bbl-google.js`) arrive in 1.1.0.

## Tests

`npm install` once, then `npm test`. All tests pass before anything is pushed.

## Apps using the kit

| App | Kit version |
| --- | --- |
| Practice Pilot | 1.0.1 |
