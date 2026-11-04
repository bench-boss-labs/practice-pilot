# Practice Pilot by Bench Boss Labs

*Better Tools. Bigger Games.*

Practice plans and animated drills for youth hockey coaches, built for an Android tablet and PC, with plans reviewed on a phone. It runs in the browser, installs to the home screen and works with no signal at the rink.

**Live:** https://bench-boss-labs.github.io/practice-pilot/

## Status

Release R0 (1.0.0): the installable shell, offline support, update banner, Help, Settings, on-device storage with Backup and Restore. The drill editor arrives in R1. Design docs (requirements, architecture, release plan, R0 deep-dive) live in the claude.ai project "Practice Pilot".

## How it's built

- Plain JavaScript modules, no build step; GitHub Pages serves the repo as is.
- The Bench Boss Labs kit is copied into `vendor/bbl-kit/1.0.0/` (version in `bbl-kit.json`). Don't edit the copy; change the kit repo and upgrade.
- Data lives in the browser's IndexedDB (`practice-pilot` database, schema version 1); see `app/schema.js`.

## Releasing

1. Add the release to `release-notes.json` (new / improved / fixed; `quiet: true` for small fixes).
2. Set the version in `version.json`.
3. `node vendor/bbl-kit/1.0.0/scripts/stamp.mjs .` writes it into every file and builds `CHANGELOG.md`.
4. `npm test` and `npm run test:e2e` must pass.
5. Ask Cristian before pushing.

## Tests

`npm install` once. `npm test` runs the logic tests (Node); `npm run test:e2e` runs the browser tests (Playwright) at tablet, PC and phone sizes.
