## 2026-02-18 - Dynamic ARIA Labels in Lists
**Learning:** List components (like `GameCard` and `CompactGameCard`) frequently use icon-only buttons for actions like "Download" or "View Details". Without dynamic `aria-label`s including the item title, screen reader users cannot distinguish between these buttons in a list.
**Action:** Always include the item's unique identifier (e.g., title) in `aria-label`s for repeated action buttons in lists (e.g., `aria-label={\`Download ${game.title}\`}`).
