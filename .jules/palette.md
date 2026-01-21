## 2025-05-26 - [Empty States]
**Learning:** Users need clear guidance when they encounter empty states (like an empty library or wishlist). A simple text message is often missed and doesn't provide a clear next step.
**Action:** Use a visual component with an icon, clear title, friendly description, and a direct call-to-action button to guide users to the relevant page (e.g., Discovery).

## 2025-05-26 - [Button Links]
**Learning:** Nesting a `<Button>` (which renders a `<button>`) inside a `<Link>` (which renders an `<a>`) produces invalid HTML.
**Action:** Use the `asChild` prop on `Button` (if using Radix/shadcn) to pass styles to the child `Link`, ensuring a semantically correct `<a>` tag with button styling.
