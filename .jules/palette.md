## 2024-05-18 - Dynamic ARIA labels for list items

**Learning:** Hardcoding `aria-label` values (like "Download game") on icon-only buttons within repeating list items (like GameCards) creates an ambiguous and frustrating experience for screen reader users, as all buttons announce the exact same generic text without indicating which specific item they apply to.
**Action:** Always incorporate dynamic data (e.g., `aria-label={\`Download ${game.title}\`}`) into ARIA labels for interactive elements within lists, grids, or carousels to provide unique and necessary context.

## 2025-02-21 - [Contextual Buttons in Lists]

**Learning:** List components (like GameCard/CompactGameCard) were using generic aria-labels (e.g., "View details") or no labels for icon-only buttons. This makes screen reader navigation confusing as users hear "View details" repeatedly without knowing which item it refers to.
**Action:** Always include the item's unique identifier (e.g., title) in the aria-label for actions within a list item (e.g., `aria-label={\`View details for ${game.title}\`}`).
## 2025-02-22 - [Redundant text in parent components]

**Learning:** When adding context-rich `aria-labels` to parent interactive elements (like a `button` or `a` tag) that already contain visually rendered text or icons inside them, screen readers may redundantly announce both the parent label AND the internal text/icons, causing confusing duplication for the user.
**Action:** When adding a consolidated or context-rich `aria-label` to a parent interactive element, any child decorative elements, status icons, or visually rendered text (e.g., a responsive `span`) within it must be explicitly marked with `aria-hidden="true"` to prevent redundant screen reader announcements.
