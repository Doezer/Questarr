## 2025-05-18 - [SSRF Protection Bypasses]
**Vulnerability:** The `isSafeUrl` function failed to handle IPv6 addresses correctly (square brackets were not stripped before IP check) and missed IPv4-mapped IPv6 addresses (e.g., `::ffff:169.254.x.x`), allowing potential access to cloud metadata services.
**Learning:** Standard URL parsing in Node.js retains brackets for IPv6 hostnames, which `net.isIP` does not handle, causing the code to fall back to `dns.lookup`. Additionally, deny-lists for IPs must account for all representations (IPv4, IPv6, Mapped).
**Prevention:** Always normalize hostnames (strip brackets) before IP validation. Use comprehensive IP checks that cover IPv4-mapped addresses when implementing blocklists.
