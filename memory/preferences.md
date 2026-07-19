# Preferences

Coding style preferences, workflow preferences, and tooling preferences specific to this project.

<!-- Format:
## Category
- Preference item
-->

## UI copy for trade-off choices

- When a setting has no universally-correct choice (e.g. transfer mode: hardlink vs symlink), prefer neutral trade-off copy over recommending one option — especially check for existing guidance elsewhere in the app first, since contradicting it (recommending hardlink on one screen, symlink on another) is worse than staying neutral. Confirmed 2026-07-18 when asked to add a symlink-over-hardlink recommendation to `ImportReviewModal.tsx` that would have contradicted `ImportSettings.tsx`'s existing hardlink-recommending guidance; user chose neutral copy over resolving in either direction.
