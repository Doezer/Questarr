## 2025-02-21 - [Contextual Buttons in Lists]
**Learning:** List components (like GameCard/CompactGameCard) were using generic aria-labels (e.g., "View details") or no labels for icon-only buttons. This makes screen reader navigation confusing as users hear "View details" repeatedly without knowing which item it refers to.
**Action:** Always include the item's unique identifier (e.g., title) in the aria-label for actions within a list item (e.g., `aria-label={\`View details for ${game.title}\`}`).
