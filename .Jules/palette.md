PALETTE'S JOURNAL - CRITICAL LEARNINGS ONLY:

## 2025-12-12 - Initial Enhancement: ARIA Labels for Icon Buttons

**Learning:** This codebase contains several icon-only buttons without `aria-label` attributes, making them inaccessible to screen reader users. This is a common accessibility issue that can be easily resolved.

**Action:** Prioritize adding descriptive `aria-label`s to all icon-only buttons to ensure they are understandable to users of assistive technologies. This will be the first micro-UX improvement.

## 2025-12-12 - Critical Fix: Reveal on Focus

**Learning:** Interactive elements hidden by opacity (like buttons in a hover overlay) create keyboard traps if they don't become visible when focused. `group-hover` alone is insufficient for accessibility.

**Action:** Always pair `group-hover:opacity-100` with `group-focus-within:opacity-100` (and `focus-within:opacity-100` for safety) to ensure keyboard users can see what they are interacting with.
