## 2024-05-22 - [Dynamic Button Context]
**Learning:** Icon-only buttons in list components (like `GameCard` and `CompactGameCard`) were using generic labels ("Download game"), which is confusing for screen reader users navigating a list.
**Action:** Always include the item's unique identifier (e.g., `game.title`) in `aria-label` for actions within a list item (e.g., `aria-label={`Download ${game.title}`}`).
