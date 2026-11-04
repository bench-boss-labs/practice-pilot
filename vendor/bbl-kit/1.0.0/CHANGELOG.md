# Bench Boss Labs kit — changelog

## 1.0.0 — 2026-11-04 (First release of the Bench Boss Labs kit)

- **New:** Brand colours, type and spacing in light and dark themes, from the Bench Boss Labs design system (bbl-tokens.css).
- **New:** Shared components: app header, buttons, cards, fields, pills, chips, update banner, toasts, dialogs and the What's new list (bbl-components.css).
- **New:** Update banner, What's new and App history, read from each app's release-notes.json (bbl-updates.js).
- **New:** The standard Help screen (bbl-help.js).
- **New:** The standard Install section for Settings › This device: installed, an Install button, or the steps for this device (bbl-install.js).
- **New:** Opens with no internet, with a 4-second fallback to the saved copy; a rink Wi-Fi sign-in page can't break it (bbl-sw.js, bbl-offline.js).
- **New:** On-device storage with schema versions, automatic upgrades with a backup first, and Backup and Restore files (bbl-store.js).
- **New:** The stamp script writes the version into every file and builds CHANGELOG.md (scripts/stamp.mjs).
