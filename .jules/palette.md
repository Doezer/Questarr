## 2025-02-21 - Accessibility Context for Icon-Text Groups
**Learning:** Elements made focusable with `tabIndex={0}` must provide context via `aria-label` or `role` if the visual label (icon + text) is not self-explanatory to a screen reader user.
**Action:** When making non-interactive elements focusable for tooltips, always add `role="img"` (or appropriate role) and a descriptive `aria-label` that includes the full context (e.g., "Rating: 8/10" instead of just "8/10").
