## 2025-05-18 - [SSRF Protection Bypasses]

**Vulnerability:** The `isSafeUrl` function failed to handle IPv6 addresses correctly (square brackets were not stripped before IP check) and missed IPv4-mapped IPv6 addresses (e.g., `::ffff:169.254.x.x`), allowing potential access to cloud metadata services.
**Learning:** Standard URL parsing in Node.js retains brackets for IPv6 hostnames, which `net.isIP` does not handle, causing the code to fall back to `dns.lookup`. Additionally, deny-lists for IPs must account for all representations (IPv4, IPv6, Mapped).
**Prevention:** Always normalize hostnames (strip brackets) before IP validation. Use comprehensive IP checks that cover IPv4-mapped addresses when implementing blocklists.

## 2025-05-24 - [Unverified Outgoing Requests (SSRF)]

**Vulnerability:** Endpoints accepting external URLs (like `/api/indexers/prowlarr/sync` and `/api/indexers/test`) were missing calls to the existing `isSafeUrl` validator, allowing potential Server-Side Request Forgery against cloud metadata or internal network services.
**Learning:** The application relies on manual invocation of `isSafeUrl` in route handlers. Developers must explicitly add this check for any user-supplied URL intended for outgoing requests.
**Prevention:** Audit all endpoints accepting URLs. Consider using a centralized validation middleware or Zod schema refinement that automatically enforces `isSafeUrl` validation on URL fields.

## 2025-05-24 - [SSRF in RSS Feeds]

**Vulnerability:** The RSS feed creation and update endpoints (`POST /api/rss/feeds` and `PUT /api/rss/feeds/:id`) lacked `isSafeUrl` validation, allowing attackers to force the server to fetch arbitrary URLs, including cloud metadata services (`169.254.169.254`).
**Learning:** Even if `isSafeUrl` exists, it must be applied to _all_ inputs that trigger server-side requests. RSS feeds are a common vector for SSRF because they inherently involve fetching remote content.
**Prevention:** Apply `isSafeUrl` validation to all URL inputs in API routes. Implement defense-in-depth by also validating the URL at the point of use (in `rssService.refreshFeed`).
## 2024-05-24 - SSRF Bypass via URL Userinfo
**Vulnerability:** The `/api/stats/discord-share` endpoint was vulnerable to Server-Side Request Forgery (SSRF) because it validated webhook URLs using `startsWith("https://discord.com/api/webhooks/")` and then fetched them using the standard `fetch` API.
**Learning:** Checking for string prefixes on URLs is insufficient for security because the userinfo component (e.g. `https://discord.com/api/webhooks/@127.0.0.1`) can be used to bypass the check. The `fetch` API and URL parsers will interpret `127.0.0.1` as the hostname and `discord.com` as the credentials.
**Prevention:** Never rely on string prefix matching for URL validation. Always use the project's `safeFetch` utility which properly resolves and validates the target IP address to prevent SSRF and DNS rebinding attacks.
