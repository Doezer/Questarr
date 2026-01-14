## 2024-05-23 - SSRF in Fetch Loops
**Vulnerability:** Unvalidated `fetch` calls in loops processing user-supplied URLs (e.g., download bundling, Prowlarr sync).
**Learning:** The application bundles external resources by fetching them directly. Developers might assume input URLs are safe or just "links".
**Prevention:** Always use `isSafeUrl` before any `fetch` call that uses user-controlled input, even if it's "just" downloading a file.
