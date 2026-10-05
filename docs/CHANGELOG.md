# Changelog

All notable changes to this project will be documented in this file.

## [1.5.1-rc1] - 2026-10-xx

### Added

- **Installed version**: each game records the version you have installed, editable in the game details modal with suggestions from your downloads' release names. It is filled in automatically when a full-game or update download finishes, and update releases that are not newer than it no longer raise "Game Updates Available" (#1142).

## [1.5.0] - 2026-09-xx

### Added

#### Library & Discovery

- **Root folder / Scan Disk**: discover games already present on disk, plus safe recursive file discovery within a game's own folder to reconcile files already there (#943, #892, #938).
- **Platforms setting**: one Settings > Platforms list to always only see your platform of choice by default across Library, Discover, Add Game, and download search (#1018, #1104).
- **Per-game target platforms** for automatic downloads (#1048).
- **Platform and release year filters** on game search (#897).
- **Library filters**: added filters to hide shelved games and games already owned from search/discover results (#1089).
- **"Playing" status** for games (#1043), with a dedicated **Playing** page — journal notes, a milestones checklist, screenshots, and Steam achievements per game (#1080).
- **Crack status** section on the game detail page (#1012, #1062).
- **Time to Beat** via IGDB's official endpoint (#1063).
- **Sort menu** on the Library page, plus an indexer-priority sort option for downloads (#980, #963).
- **DLC & expansions**: games now persist their IGDB expansions and show them in a new DLC tab on the game detail page, with cover art, release year, and a category badge (#1105).
- **xREL**: surfaces a release's nuke reason with a "Nuked" badge (#948).
- **Screenshot lightbox**: carousel navigation with arrow-key and swipe support, plus an image counter (#804).
- **Wishlist**: configurable grid column count (#871).
- **Content filtering**: filters to hide erotic and age-restricted (ESRB AO / PEGI 18) games from the library, search, and discovery pages (#808).
- **Windows 2000 style mode**: a retro cosmetic theme (#807).
- **Sidebar**: moved the xREL and RSS pages under Discover (#1086). Wishlist moved into Library group alongside Playing; on mobile, Playing replaced Wishlist in the pinned bottom-nav slots (Wishlist stays reachable via "More") (#1080).

#### Downloads & Import

- **AI release analysis (TypeSafe/Jev)**: [EXPERIMENTAL/OPTIONAL/BYOK] auto-download can run an AI legitimacy check and hold a suspicious match for manual review (notified over Apprise) instead of downloading it (#1070, #1077, #1078). Uses Jev model from TypeSafe via OpenRouter, with your own API key. [Learn about Jev](<[url](https://share.gemini.google/lrbViMx1ndNB)>)
- **Packs/Addons** download category (#876).
- **Password-protected archives** are now routed to manual review with a password prompt, instead of failing (#1033).
- **SABnzbd**: archive password support for G4U-style releases (#962).
- **Pre-import security scanning**: [OPTIONAL] VirusTotal (hash lookup) and ClamAV (local deep scan) checks before a download is unpacked or moved into the library; a detection quarantines the download and raises a Security Alert notification instead of importing it (#1102).
- **Pending imports**: orphaned downloads (missing game record) get a dedicated "Link Game" action to reattach them instead of stalling silently (#932).
- **Download search**: results now link back to their indexer/source page (#872).
- **Global release name blacklist**: Settings → Discovery & Downloads lets you hide any release whose title contains a given term, case-insensitively, across manual search, both auto-search cycles, and AI enrichment/auto-download (#1112, closes #991).

#### Integrations

- **PostgreSQL backend**: [OPTIONAL] Questarr can now run on PostgreSQL instead of SQLite, selected with `DB_DIALECT=postgres` plus `DATABASE_URL` (setting `DATABASE_URL` alone keeps SQLite) (#1046). See `docs/DATABASE.md` if you're looking to migrate from SQLite.
- **Playnite integration**: API keys, an integration API, and a Playnite extension. See [the extension's README](../extensions/playnite-questarr/README.md) for setup (#986).
- **Steam wishlist**: optional auto-sync on a configurable interval, alongside the existing manual sync (#805).

#### Deployment & Admin

- **Deployment**: Windows installer build (#933); a Helm chart, a Proxmox VE LXC script, and CasaOS/Umbrel/Cosmos Cloud app-store definitions (#983, #985, #982).
- **Reverse proxy subdirectory deployments**: `QUESTARR_BASE_PATH` is now a runtime server config (no rebuild needed) for serving Questarr behind a path prefix; see `docs/REVERSE_PROXY.md` (#844).
- **`/api/status`**: new dashboard endpoint (#984).
- **Debug logging**: optional logging of full downloader responses (#927).
- **Telemetry**: [OPTIONAL] automatic reporting of unhandled server errors (#924). This uses the same function as the "Send Logs" button in the logs page and allows maintainers to proactively analyze errors not necessarily raised by users.
- **Password reset**: `npm run reset-password` CLI script for a forgotten admin password (#860).

### Fixed

#### Import & Archives

- **Hardlink import**: falls back to copy when hardlinks are unsupported, including for multi-file downloads (#873, #978).
- **Import**: `modeUsed` was only reporting the last per-file fallback (#931).
- **Import**: a download that disappeared from the client (e.g. pruned after a seed-ratio limit) was silently marked owned without importing anything; now routed to manual review (#837). A failed import used to dead-end with no retry path; failures now go to Pending Manual Imports so they can be adjusted and retried (#840).
- **Import**: a single-file torrent saved outside a subfolder produced a 500 instead of importing (#856).
- **SABnzbd**: fixed the manual Confirm Import path resolution and a history lookup that missed archived/failed downloads (#940, #1044); manual Confirm Import could also build a duplicated source path (`.../release/release`) (#937).
- **NZBGet**: the configured category was never applied to new downloads (#851); completed downloads with a non-`SUCCESS/ALL` history status were reported as aborted (#855); `downloadDir` was never populated on completion, so successful downloads never reached import (#932).
- **Usenet**: download ids (e.g. SABnzbd's `nzo_id`) were incorrectly lowercased on claim/scan routes, breaking case-sensitive status lookups (#1055).
- **Nintendo Switch**: fixed silent import failures for NSP/XCI releases (#1021).
- **Archive extraction**: RAR archives silently produced empty output instead of failing loudly; routed through a working extractor, ending on Alpine-native 7-Zip plus RARLAB's official `unrar` binary for reliable RAR/multi-volume support (#803). Archives now unpack at the destination instead of the downloader directory, with hardened multi-volume (`.partN.rar`, `.7z.NNN`) sibling detection (#1049). A large/slow extraction could also be re-triggered mid-unpack by the next status check, clobbering itself (#1014).

#### Downloaders & Indexers, Integrations

- **qBittorrent**: v5+ downloads not tracked when the API returns an async `pending_count`; v5.2+ torrent-upload success not recognized; a fallback for v2.0.2 (#1015, #926, #869).
- **Prowlarr**: download links no longer double-wrapped when the proxy URL comes back on a container IP (#1007).
- **Indexers**: search categories outside 40xx/10xx were being dropped; hardened Newznab/Torznab caps discovery (#1058, #951).
- **Downloaders**: credential policy now validates the resolved URL, not just `useSsl` (#1061).
- **IGDB**: validated the rate-limit setting's range; canonicalized/deduped game editions in search results (#1020, #950).
- **Unraid**: fixed the Community Applications template category and default `PUID`/`PGID`, and added an optional Library Path and `UMASK` setting (#850, #886).
- **safeFetch**: fixed the `Host` header being silently replaced by the resolved IP on plain-HTTP requests, which broke Prowlarr's proxy-link matching (#822).
- **HTTPS**: the `ssl.redirectHttp` option never redirected anything, because its middleware was registered after the web app's catch-all route. It now runs ahead of every route and keeps the base path and query string. With `QUESTARR_BASE_PATH` set, the HTTPS listener now also serves the app under that path, like the HTTP one.

#### Documentation

- **`docs/SECRETS.md`** §8 wrongly said the `pg-to-sqlite` credential-logging issue was still open; it was fixed in v1.4.0. Now states the affected range (v1.1.0–v1.3.1) and that operators who kept logs from that range should rotate their Postgres password.
- **v1.1 Migration guide**: added the Compose project name to `docs/MIGRATION.md`'s own example commands (#1084).

#### UI & Misc

- **Clipboard**: copy buttons now work on non-secure (HTTP) contexts (#961).
- **Calendar**: follow-up fixes to the year view's date filtering.
- **Release notifications**: no longer sent for games added with a release date already in the past (#874).
- **Scroll areas**: scrollbars stayed hidden except while actively scrolling (#875).
- **Game status**: a game marked Playing, Shelved or Completed kept being reset by the download pipeline: an update download flipped it to Downloading, then Owned on import (or Wanted if the download failed), and a root-folder scan flipped it to Owned. Those statuses are now left alone, update/pack searches keep running for Playing and Shelved games, and Discover treats them as owned.
- **Auto-search**: with a minimum seeders rule set, every Usenet result was dropped because NZBs have no seeders; the rule now only applies to torrents (as in the manual download dialog), and Usenet results rank by grabs.
- **Cover art**: games without a cover (manual or API adds) showed a broken image with its alt text on top, because the fallback pointed at a file that was never shipped. A bundled placeholder now takes its place.
- **API**: unknown `/api/*` paths returned the web app's HTML with a 200; they now answer with a JSON 404.

### Changed

#### Auth & Settings

- **Auth**: migrated to httpOnly cookies plus CSRF, with a bearer-token fallback (#954).
- **IGDB credential validation** and a test-connection UI (#1064).
- **Settings**: reorganized page tabs by domain; moved the Discord webhook config to the Stats page (#949, #946).
- **Appearance**: unified theme selection into a single dropdown (#1042).

#### Performance

- **Calendar**: greyed out past days and games in the year view; optimized its date filtering for performance (#1051, #1076).
- **Downloads page**: optimized filtering with `useMemo` (#1041).
- Made the pending-imports alert collapsible across multiple reviews (#1038).

#### Mobile

- **Mobile**: personal notes collapse behind an Edit button; the Settings tab strip gets scroll-fade hints (#993, #969).

#### Other

- **Logs page**: history limit raised from 200 to 1000 lines (#928).
- Dependency updates: `undici` 7.29.0 → 8.9.0 (direct dependency, used by the SSRF-safe fetch wrapper in `server/ssrf.ts`). No vulnerability fix — see `docs/CVE_FIXES_BY_RELEASE.md` for verification. Major version bump; undici 8.9.0 requires Node `>=22.19.0`, so Questarr's own `engines.node` floor is raised from `>=20` to `>=22.19.0` to match — this only formalizes existing practice, since CI (`node-version: 26.x`) and the production Docker image (`node:26-alpine`) were already on Node 26. Full test suite and `server/__tests__/ssrf.test.ts` verified green against the new version.

### Security

#### Access Control

- **API auth**: added a default-deny boundary and fixed an unauthenticated `GET /api/config` (#953).
- **Real-time channel**: the Socket.IO connection now requires the same session as the REST API. Before, anyone who could reach the port could open it and receive the live server log stream, notifications and download progress. A handshake that relies on the session cookie must also come from Questarr's own origin (reverse proxies that set `X-Forwarded-Host` work unchanged; otherwise list the public URL in `ALLOWED_ORIGINS` or `APP_URL`).
- **Delete with files**: deleting a game whose library path is the library root (or an opted-in root folder) itself no longer removes that whole folder.
- **Auth**: failed login attempts are now logged for brute-force/credential-stuffing detection (#858); fixed an IDOR letting any user modify or delete another user's games, and strengthened the password policy to 8+ characters with a letter and a digit (#859).
- **Input validation**: hardened indexer search, qBittorrent, NexusMods, and game-status endpoints against unbounded/malformed input (#857).

#### Network & Downloads

- **Downloader SSRF**: closed a gap in outbound requests (#890).
- **Downloaders**: self-signed-certificate TLS bypass is now opt-in, not default (#947).
- **Archive import**: source reads are now restricted to configured downloader roots (#1052).
- **Indexers**: sanitized the comments URL before linking release titles (XSS) (#895); enforced the HTTP indexer API-key policy with a per-indexer insecure-LAN opt-in (#1022).
- **SSL settings**: the cert/key path containment check now runs on the same canonicalized path that's saved, closing a checked-vs-used mismatch flagged by CodeQL (#1113).
- **SPA catch-all route**: now rate limited, alongside the existing `/api` limiter (#1113).
- **Logs**: an indexer-controlled release title can no longer land in a `console.error` format-string position (#1113).

#### Scanning & Logging

- **Scan Disk endpoint**: limited recursive traversal with a max file count and time budget, and added rate limiting, reducing DoS exposure on large directory trees (#1069).
- **Logging**: production no longer hardcodes the debug log level, and secrets are now redacted from logs; API keys/tokens are also redacted before logs are sent to support (#952, #960).
- **Search engines**: `/robots.txt` no longer bypasses security headers, and instances are kept out of search-engine indexes (#941, #939).

#### Dependency Vulnerabilities

- Fixed 17 known vulnerabilities in production dependencies since 1.4.2: `fast-uri` (6), `multer` (5), `ip-address` (2), `qs` (2), `undici` (1), plus a critical IP-spoofing vulnerability in `proxy-addr` (#879, #981, #997, #1000, #1028, #1066, #1118).
- Fixed 9 known vulnerabilities in build and test tooling that is not shipped in the production image: `js-yaml` 4.x (2), `nanoid` 3.x (2), `browserslist` (2), `baseline-browser-mapping`, `postcss` and `vitest`.
- Patched the Docker base image's `openssl`/`expat` and removed its bundled npm CLI (dropping vendored `tar`/`ip-address`/`brace-expansion` copies) (#1113).

### Vulnerabilities Addressed

Inventory from `scripts/cve-report.mjs` / `scripts/cwe-report.mjs` against OSV.dev (`v1.4.2` → `main`). Fix versions checked per advisory; the fixes that already shipped in the 1.4.1/1.4.2 hotfixes are listed in that section, not repeated here.

#### Production dependencies

- **proxy-addr** (npm `overrides` pin) 2.0.7 → 2.0.8 — fixes **CVE-2026-90711** ([AIKIDO-2026-101201](https://security.aikido.dev/cve/AIKIDO-2026-101201), CRITICAL) — an undersized IPv4-mapped IPv6 trust-subnet prefix (e.g. `::ffff:10.0.0.0/8` instead of `::ffff:10.0.0.0/104`) was accepted without error but trusted every IPv4 address on the internet, letting unauthenticated clients spoof `X-Forwarded-For` and bypass IP-based access controls, rate limiting, and audit logging, vulnerable range `>=1.1.0 <=2.0.7`. Reaches production via `express`, which pins `proxy-addr: ~2.0.7` (a range that otherwise excludes the fix). Not yet indexed by OSV.dev, so absent from the script output.
- **fast-uri** (npm `overrides` pin) 3.1.4 → 3.1.7 — fixes 6 HIGH advisories (#879, #981). Reaches production through `ajv`, an optional peer of `@hookform/resolvers` (and dev-only through `secretlint`):
  - **CVE-2026-18446** (GHSA-7p8r-x3mc-p8w7) — host confusion via backslash authority introducer (fixed in 3.1.5)
  - **CVE-2026-75931** (GHSA-5jgf-p345-68v8) — host confusion via skipped IDN canonicalization on scheme-relative references
  - **CVE-2026-76172** (GHSA-jqff-g426-hqxp) — host confusion via percent-encoded scheme normalization
  - **CVE-2026-75975** (GHSA-f65p-4m7j-42xc) — SSRF via malformed IPv6 normalization
  - **CVE-2026-75899** (GHSA-fph4-wmhf-6fwf) — SSRF via repeated hostname percent-decoding
  - **CVE-2026-84292** (GHSA-qw65-cvwx-89v3) — authority injection via an unvalidated port in `serialize`
- **multer** 2.2.0 → 2.4.0 — fixes 5 CVEs (#1000, #1066):
  - **CVE-2026-82333** (GHSA-535w-7cp7-47q4, HIGH) — DoS via oversized array index in field names
  - **CVE-2026-77037** (GHSA-qfvm-cv95-jqjf, HIGH) — DoS via file descriptor leak on aborted uploads
  - **CVE-2026-77078** (GHSA-wc9g-mqfw-jrwm, HIGH) — DoS via crafted multipart field names
  - **CVE-2026-88932** (GHSA-3pph-fpjx-jg34, MODERATE) — DoS via orphaned disk writes on aborted uploads (fixed in 2.4.0)
  - **CVE-2026-77063** (GHSA-qvfw-j98x-7q72, LOW) — file size limit bypass via async `fileFilter` race condition
- **ip-address** (npm `overrides` pin, transitive via `express-rate-limit` and `socks`) 10.5.0 → 10.7.2 — fixes **CVE-2026-101913** (GHSA-rpw4-54j3-4h4q, MODERATE) — `Address6.isLinkLocal()` recognized `fe80::/64` rather than `fe80::/10` — and **CVE-2026-101910** (GHSA-2vr4-cq9g-pvrc, MODERATE) — the NAT64 local-use range `64:ff9b:1::/48` was not classified; both allowed SSRF and trust-boundary bypass (#1118).
- **qs** (npm `overrides` pin) 6.15.2 → 6.16.0 — fixes **CVE-2026-82417** (GHSA-4mjr-xmp4-gh2g, MODERATE) — DoS via attacker-controlled `isBuffer`, vulnerable range `>=2.2.5 <6.16.0` — and **CVE-2026-82562** (GHSA-x5fp-wj9c-mxmx, MODERATE) — array-limit bypass via bracket-key comma parsing, vulnerable range `>=6.14.2 <=6.15.3`. Reaches production via `express`/`body-parser`, both of which pin `qs: ~6.15.1` (a range that otherwise excludes the fix); the same override also closes the gap in `openid`, `steam-web`, and `superagent` (#997).
- **undici** (direct dependency) 8.10.0 → 8.10.2 — fixes **CVE-2026-85024** (GHSA-3wwx-pv8p-q78v, MODERATE) — DoS via an unhandled error in WebSocket permessage-deflate decompression (#1028). The earlier 7.29.0 → 8.9.0 major bump crossed no fix boundary (see Changed). Before it became a direct dependency, `undici` was only a dev-only transitive of `jsdom`, whose 7.28.0 → 7.29.0 refresh fixed CVE-2026-13697, CVE-2026-16728, CVE-2026-14643, CVE-2026-15157 and CVE-2026-16729 in test tooling.

#### Development dependencies (not shipped in the production image)

- **js-yaml** (npm `overrides` pin, scoped to `@eslint/eslintrc`, and the other nested 4.x copies) 4.3.0 → 4.3.2 — fixes GHSA-5p4m-2wfm-xmqj (no CVE assigned, HIGH) — quadratic CPU consumption in `!!omap` resolution — and **CVE-2026-84375** (GHSA-2883-xcg3-v3hh, HIGH) — `maxTotalMergeKeys` did not limit CPU use for empty merge sources (#894, #997, #998). The top-level `js-yaml` 5.x used in production was already unaffected.
- **nanoid** (nested under `postcss`) 3.3.12 → 3.3.18 — fixes **CVE-2026-67214** (GHSA-28wg-ghj8-5hjv, HIGH) and **CVE-2026-67213** (GHSA-2v37-7h3g-55p8, HIGH) — generators could loop indefinitely with a negative or zero size (#917). The production `nanoid` 6.x was never affected.
- **browserslist** 4.28.4 → 4.28.9 — fixes **CVE-2026-73088** (GHSA-73wf-gq98-2v4g, HIGH) — crash / prototype write via untrusted custom stats — and **CVE-2026-73089** (GHSA-c83g-rgw3-j3cx, HIGH) — unbounded memory growth via distinct query results.
- **baseline-browser-mapping** 2.10.40 → 2.11.21 — fixes **CVE-2026-45819** (GHSA-w5vr-8v7q-w6rv, MODERATE) — process termination on invalid input.
- **postcss** 8.5.18 → 8.5.28 — fixes **CVE-2026-69153** (GHSA-fxqj-rqcc-2cmp, MODERATE) — attacker-controlled `sourceMappingURL` could read arbitrary `.map` files when `from` is unset (#882).
- **vitest** / **@vitest/mocker** 4.1.10 → 5.0.1 — fixes **CVE-2026-84373** (GHSA-82fw-gwwq-j7x9, MODERATE) — path traversal / arbitrary file read via the redirect mock (#971).
- **undici** (scoped `overrides` pin under `node-gyp`, via `@lizenz/checker`) 6.28.0 → 6.29.0 — fixes **CVE-2026-85024** (GHSA-3wwx-pv8p-q78v), the same advisory as the production entry above (#1118).

#### Container image

- Docker base image: `apk upgrade` for Alpine's patched `openssl`/`expat` (Trivy #417, #361, #351, #364, #363); removed the base image's bundled npm CLI after `npm prune`, dropping its vendored `tar`/`ip-address`/`brace-expansion` copies (Trivy #350, #287, #286, #272) (#1113).

### Removed

- **Legacy PostgreSQL migration tooling**: removed `scripts/pg-to-sqlite.ts` and
  `docker-compose.migrate.yml`. The tool dated from the v1.1 move off PostgreSQL
  and only knew about 8 of the project's 19 tables, so pointing it at a current
  database would have silently skipped the rest — and it continued past
  per-table failures while still reporting `Migration completed.` Operators
  still migrating a pre-v1.1 PostgreSQL installation should use the archived
  **v1.4.2** release — see [MIGRATION.md](./MIGRATION.md), which now inlines the
  pinned compose file, links the sources by tag permalink, and spells out how to
  verify the result.

## [1.4.1 - 1.4.2] - 2026-08

Hotfix releases addressing dependency vulnerabilities

### Security

- **1.4.1 Dependency Vulnerabilities**: Fixed 6 known vulnerabilities in `brace-expansion` (3), `fast-xml-parser`, `js-yaml`, and `body-parser`, plus a devDependency-only fix in `fast-uri` and a second, devDependency-only resolution path for the `brace-expansion` advisories.
- **1.4.2 Dependency Vulnerabilities**: Fixed 4 known vulnerabilities in `ip-address` (3) and `socket.io-parser`.

### Vulnerabilities Addressed

#### 1.4.1

- **brace-expansion** (npm `overrides` pin `^5.0.8`, resolved 5.0.9) 5.0.7 → 5.0.9 — fixes 3 HIGH CVEs:
  - **CVE-2026-14257** (GHSA-mh99-v99m-4gvg) — DoS via unbounded expansion length causing an out-of-memory process crash
  - **CVE-2026-13149** (GHSA-3jxr-9vmj-r5cp) — DoS via exponential-time expansion of consecutive non-expanding `{}` groups
  - **CVE-2026-69152** (GHSA-rgw5-rvv9-x895) — DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation
- **fast-xml-parser** 5.10.0 → 5.10.1 — fixes **CVE-2026-73569** (GHSA-8r6m-32jq-jx6q, HIGH) — repeated DOCTYPE declarations reset entity expansion limits.
- **js-yaml** 5.2.1 → 5.2.2 — fixes **CVE-2026-73643** (GHSA-pm4m-ph32-ghv5, HIGH) — exponential parsing time in flow collections leading to denial of service.
- **body-parser** 1.20.5 → 1.20.6 — fixes **CVE-2026-12590** (GHSA-v422-hmwv-36x6, LOW) — an invalid `limit` value silently disabled size enforcement, allowing arbitrarily large request payloads.
- **fast-uri** (npm `overrides` pin, dev-only at the time) 3.1.3 → 3.1.4 — fixes **CVE-2026-16221** (GHSA-v2hh-gcrm-f6hx, HIGH) — host confusion via a literal backslash authority delimiter.
- **minimatch** override pinned to `^10.2.5` — closes a second resolution path for the `brace-expansion` advisories: `eslint-plugin-react`'s bundled `minimatch@3.1.5` still pulled the vulnerable `brace-expansion@1.1.x`. devDependency-only (not shipped in the production image), but flagged by `npm audit` without `--omit=dev`, so pinned for a fully clean audit.

#### 1.4.2

- **ip-address** (transitive, via `express-rate-limit`) 10.2.0 → 10.5.0 — fixes 3 CVEs; no `overrides` pin needed, `express-rate-limit`'s `^8.5.2` range already permitted 10.5.0:
  - **CVE-2026-69192** (GHSA-mwp4-54f8-5fhr, HIGH) — `Address4` decoded leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass
  - **CVE-2026-54272** (GHSA-22jq-vg5j-6vgg, MODERATE) — misclassification of IPv4-mapped/NAT64 IPv6 addresses
  - **CVE-2026-69198** (GHSA-4xrf-jv44-h6hh, MODERATE) — a CIDR suffix on the parsed address suppressed special-use classification
- **socket.io-parser** (npm `overrides` pin) 4.2.6 → 4.2.7 — fixes **CVE-2026-69185** (GHSA-2m8v-j782-fhvr, HIGH, CVSS 7.5) — zero-attachment memory exhaustion, vulnerable range `4.0.0 - <4.2.7`. Reaches production via `socket.io`/`socket.io-client` (real-time download-progress and notification updates).

## [1.4.0] - 2026-07-16

Migration note:

- The `PORT` variable in `docker-compose.yml` has been split into two: `HOST_SIDE_PORT` (host-side binding, default `5000`) and `CONTAINER_INTERNAL_SIDE_PORT` (internal container port, default `5000`). If you had `PORT` set in your `.env` to customize the host port, rename it to `HOST_SIDE_PORT`.
- With Post-processing, don't forget to add your volume mapping to the docker compose file.

An easter egg has been added to the app; shouldn't be too hard to find if you think about the very famous easter eggs in gaming! Let me know what you think.

### Added

- **Post-Processing Pipeline**: Added an automated post-processing pipeline that handles unpacking and organizing files after a download completes (#583)
  - Files can be unpacked automatically by setting auto-unpack setting
  - An import modal is displayed via an alert in the library when the system cannot find the input or output path.
- **Import History**: New page listing import tasks (game claims, post-processing imports, Steam syncs) with a retention purge cron job to keep the history tidy (#714).
- **Deluge Support**: Added Deluge as a supported downloader (#697).
- **Synology Download Station**: Added support for Synology's built-in Download Station as a downloader (#567).
- **Apprise Notifications**: Added Apprise API and CLI notification modes. Use API mode with a remote Apprise server or CLI mode with the local `apprise` binary from Questarr settings. Bundled Python and Apprise in the default image so CLI mode works without a separate image split.
- **Personal Notes**: Added the ability to attach personal notes to a game.
- **Shelved Status**: Added a "shelved" status for games (#645).
- **Real-Time Logs**: Added a real-time log streaming page with configurable detail level and truncation for large payloads.
- **Send Logs**: Added the ability to send logs directly from the app for troubleshooting (#648).
- **Search Improvements**: Added a date filter and infinite scroll to search, plus the ability to delete a result from the library directly from search (#673).
- **Library Ratings**: Added a user rating filter and inline rating in the library's list view; the Stats page now shows average user rating.
- **Favorite groups**: Added favorite release groups for auto downloading releases, in the settings.
- **G4U as indexer**: Added g4u.to as an indexer type, using their VIP API (#689).
- **Vite Base Path**: Added support for deploying behind a custom base path (#630).
- **Code of Conduct**: Added Contributor Covenant Code of Conduct.
- **Downloaders Compatibility doc**: Added a document detailing compatibility for supported downloaders.

### Security

- **SSRF**: Hardened outbound fetches with DNS rebinding protection (#698).
- **Dependency Vulnerabilities**: Fixed 3 known vulnerabilities in `esbuild`, `form-data`, and `ws` (#734).
- **CI Hardening**: Applied StepSecurity best practices, added a blocking Semgrep SAST gate and secretlint scanning, and added automatic SBOM generation to the Docker release pipeline.
- **OpenSSF**: passed baseline 1, 2 and 3 security self-eval (ongoing for 'passing' check). Update to current checks and new ones for hardened security. New policies. See SECURITY.md on GitHub.

### Changed

- **Dashboard**: Consolidated the Dashboard into the Library component, removing the separate Library page.
- **Docker**:
  - Refactoring of the entrypoint script.
  - `SQLITE_DB_PATH` is now optional and exported with a default of `/app/data/sqlite.db`.
  - The `PORT` variable in `docker-compose.yml` has been split into two: `HOST_SIDE_PORT` (host-side binding, default `5000`) and `CONTAINER_INTERNAL_SIDE_PORT` (internal container port, default `5000`). If you had `PORT` set in your `.env` to customize the host port, rename it to `HOST_SIDE_PORT`.
- **Dependencies**: Node 22 to 26. Removed duplicate `@types/multer` entry from `package.json`; updated Radix UI, semver, and other minor dependencies; upgraded `codecov/codecov-action` from v5 to v7; updated numerous packages via Dependabot including `lucide-react`, `recharts`, `framer-motion`, `jsdom`, `express`, `express-rate-limit`, `@tanstack/react-query`, `react-hook-form`, and GitHub Actions.
- **Performance**: Optimized the Add Game modal's collection-status check with a Set lookup (#677); the downloads page now polls every 30 seconds.
- **Downloaders Module**: Refactored `downloaders.ts` into smaller modules for easier maintenance (#627).
- **Notifications Behaviour**: the notifications now trigger only once per event, instead of once per cron job.
- **Genres & Platforms Display**: Overflow-safe tag list for genres and platforms on game cards (#680).
- **Aborted Downloads**: Definitive downloader failures are now surfaced as "Aborted" instead of an unclear stuck state.
- **List View**: Removed the ultra-compact view in favor of an updated column-based row view.
- **Date display**: year-only release dates now display in full.
- **Release Date Sorting when adding a game**: IGDB results are not sorted by release date.
- **Mobile Experience**: Significant improvements to mobile layout and navigation (#644).
- **Downloader/Indexer Version Logging**: Periodic logging of downloader and indexer versions to aid troubleshooting (#649).

### Removed

- Removed the HLTB integration from Questarr (no API or stable service).

### Fixed

- Fixed status switcher UI and badge positioning in game details (#764).
- Fixed handling of the `stoppedDL` state in qBittorrent v5+.
- Fixed an error when adding a torrent via qBittorrent.
- Fixed a scrolling issue in the claim modal.
- Fixed Torznab/Prowlarr download URL rewriting so proxied URLs are no longer double-wrapped on host aliases (#647).
- Fixed the files view and missing seed/leech numbers in download details.
- Hardened download status checks and migrated the Steam logger.
- Addressed edge cases in auto-search download rules
- Fixed the "Has results" badge that would create an offset in the game card.
- Fixed the Home Assistant add-on: moved to the repo root and corrected /data permissions on fresh installs (#696). See [../questarr/README.md]

### Vulnerabilities Addressed

- **js-yaml** 4.1.1 → 5.2.1 — fixes **CVE-2026-53550** (GHSA-h67p-54hq-rp68, MODERATE) — quadratic-complexity DoS in merge-key handling via repeated aliases.
- **multer** 2.1.1 → 2.2.0 — fixes the 2 CVEs left open in the v1.3.0
  - **CVE-2026-5038** (GHSA-3p4h-7m6x-2hcm, MODERATE) — DoS via incomplete cleanup of aborted uploads
  - **CVE-2026-5079** (GHSA-72gw-mp4g-v24j, HIGH) — DoS via deeply nested field names
- **form-data** (transitive, resolved 4.0.5 → 4.0.6) — fixes **CVE-2026-12143** (GHSA-hmw2-7cc7-3qxx, HIGH) — CRLF injection via unescaped multipart field names/filenames.
- **ws** (transitive, resolved 8.18.3 → 8.21.0) — fixes 2 CVEs:
  - **CVE-2026-45736** (GHSA-58qx-3vcg-4xpx, MODERATE) — uninitialized memory disclosure
  - **CVE-2026-48779** (GHSA-96hv-2xvq-fx4p, HIGH) — memory exhaustion DoS from tiny fragments/data chunks
- **esbuild** (devDep) 0.28.0 → 0.28.1 — fixes GHSA-g7r4-m6w7-qqqr (no CVE assigned) — the Windows dev-server arbitrary-file-read issue flagged as still-open in the v1.2.1/v1.3.0 entries is now fixed.
- **esbuild, nested copy** — the new npm `overrides` entry (`@esbuild-kit/core-utils` → `esbuild ^0.25.0`) bumps that dependency's bundled esbuild from 0.18.20 to 0.25.12, fixing GHSA-67mh-4wv8-2f99 (no CVE, MODERATE — dev server accepts arbitrary cross-origin requests). Separately, `tsx`'s own duplicate nested esbuild copy (0.27.7, carrying the same GHSA-g7r4-m6w7-qqqr as above) was deduped away entirely by this bump round rather than upgraded.
- **vite** (devDep) 8.0.12 → 8.1.3 — fixes both issues left open in the v1.3.0:
  - **CVE-2026-53571** (GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass
  - **CVE-2026-53632** (GHSA-v6wh-96g9-6wx3) — launch-editor NTLMv2 hash disclosure via UNC path on Windows

## [1.3.1] - 2026-05-13

### Fixed

- Fix NZB URL encoding for Prowlarr and other indexers where `+` characters in base64-encoded links caused "Invalid link" errors — applies to qBittorrent, Transmission, and rTorrent clients.
- Fix broken indexer URLs when fetching NZBs through clients that relay the request
- Fix auto-search download rules handling.
- Fix CRLF line endings in Docker entrypoint script to prevent container start failures on Linux hosts.

### Changed

- Improve rTorrent error message when Digest authentication fails.
- Added retry algo before marking a download as failed, reducing false-positive failures.
- Optimize dashboard statistics computation for faster page load.
- Optimize calendar year view by replacing `Date` parsing with string prefix matching, significantly reducing render time for large libraries.
- Add missing ARIA label to RSS feed delete button for screen reader accessibility.
- Updated Docker Compose and Dockerfile configuration.
- Dependency updates: React, express-rate-limit, fast-xml-parser, @types/express-session, and Docker CI actions.

### Addressed Vulnerabilities

- None

## [1.3.0] - 2026-04-11

### Added

- **Steam Wishlist Sync**: New button near Add game (displayed with Steam ID is provided in the settings) to sync up your backlog with your Steam wishlist, adding all games as wanted.
- **Add Game UX**: Pre-fill the add game search value with the current dashboard search query; display release date in the modal.
- **New game badges**: Three new games badges:
  - Results available, badge displayed when a game has downloads available (#517).
  - Update available, for owned games that have update type downloads available.
  - "Early Access" badge (#519).
- **Game Details Modal Redesign**:
  - Tabbed UI with IGDB metadata, full download history, game related links.
  - Game Data Integrations: IGDB and Steam metadata enrichment, gameplay-time estimates (#537), PCGamingWiki game URL lookup (#538), and NexusMods integration (#540).
  - User Ratings: Rate games directly from the game details (#530).
- **Notification on Download**: Notification updated when a download is sent to the download client, to display the downloader's name.
- **Download Linking**: Per-game and batch linking to games to claim existing downloads (#543).
- **New settings**
  - **Preferred Platform**: Select a preferred platform and filter results accordingly (#531).
  - **Preferred Release Groups**: Configure preferred release groups for auto-download, auto search and pre-filtering (#491).
  - **Auto-Search Control**: Disable auto-search for unreleased games with possibility to enable in settings (#394).
- **Stats Page**: New statistics page with Discord sharing support (#384, #493).
- **Blacklist Releases**: Blacklist unwanted releases directly from download search results (#490).
- **Updates Filter**: Filter library to show only games with available updates (#548).
- **Hide from Library**: Hide button in game details, accessible from all pages (#439).
- **Search Fields**: Added search/filter field to calendar, downloads, and wishlist pages.
- **Calendar — Year-Only Section**: Separate calendar section for games with a year-level release date but no exact date.
- **Download Enhancements**: Download indicators and shared view controls (#484); freeleech status, poster name, and leecher count per download item (#516); "Questarr-added" toggle (#523); platform filter in download dialog (#518).
- **Sidebar Page Counters**: Sidebar now shows active download count only; full counters added to the downloads page (#503).
- **Wishlist Improvements**: Toggle to show/hide unreleased games with reordered sections (released first) (#460).
- **Login Page**: GitHub link with current version info (#481).
- **Inline Priority**: Change indexer and downloader priority inline without opening settings.
- **PageToolbar**: Unified toolbar component replacing the standalone SearchBar and DisplaySettingsModal across pages (#521).
- **Migration Repair**: Automatic schema repair for the v1.2.2 → v1.3.0 migration path, to account for people using v1.3.0 before release. (#542).

### Security

- **SSRF**: Fixed SSRF vulnerabilities in RSS feed fetching (#404, #468) and magnet link redirects in qBittorrent (#508).
- **SSRF DNS Rebinding**: Fixed DNS rebinding bypass in SSRF protection layer (#385).
- **Rate Limiting**: Added brute-force rate limiting to the login endpoint (#455).
- **Credential Exposure**: Fixed credential logging, weak session secret enforcement, and missing brute-force protection (#415).
- **Information Leakage**: Fixed error messages exposing internal details (#421).
- **axios CVE**: Resolved critical axios vulnerability (#547).
- **CI Hardening**: Applied security best practices and pinned action SHAs in GitHub Actions workflows (#494, #504).
- **node-forge**: Upgraded from 1.3.3 to 1.4.0 to resolve a known vulnerability (#496).

### Changed

- **Lazy Loading**: Game details and download dialogs are now lazy-loaded for faster initial page load (#422).
- **Performance**: Server-side filtering for user games (#386); batch DB updates in game update cron job (#405); memoized sorted game lists in wishlist (#509); memoized search result sorting (#533).
- **Steam**: Removed Steam sign-in button and Steam API key requirement; fixed wishlist sync (#428).
- **IGDB**: Platform retrieval is now paginated to return complete results (#471).
- **RTorrent**: Refactored download path handling to prevent double-nesting of category directories.
- **Download Dialog**: Removed non-functional files field from the game download dialog UI; dialog no longer auto-closes after a successful download.
- **Game Card**: Displays primary genre only and shows N/A for unrated games.
- **Notifications**: Game update notifications now trigger only for owned games (#438).

### Fixed

- SABnzbd downloads lost on queue→history transition (#511).
- RTorrent download directory and NZB file parameter stripping (#472).
- Transmission download failures: RPC errors now surfaced correctly (#436).
- Torznab client not correctly handling Prowlarr redirect links (#487).
- Magnet link redirect handling for Transmission and rTorrent clients.
- Platform select dropdown overflowing the viewport (#512).
- Download search results, UI state, and download action visibility (#515, #557).
- IGDB request failures on the Discover page (#522).
- Sort option "Health" not sorting correctly (#390).
- Search bar position displaced by clear button; stats bar disappearing during search.
- Validation error when adding a game without a cover URL.
- Pino logging objects by reference instead of value.
- One-time IGDB retry on HTTP 429 to avoid hammering the API.
- Download results table header not sticky during scroll.

### Addressed Vulnerabilities

- **fast-xml-parser** 5.3.7 → 5.7.1 — fixes 4 CVEs:
  - **CVE-2026-33036** (GHSA-8gc5-j5rx-235r, HIGH) — numeric entity expansion bypassing all expansion limits (incomplete fix for CVE-2026-26278)
  - **CVE-2026-27942** (GHSA-fj3w-jwp8-x2g3, LOW) — stack overflow in XMLBuilder with `preserveOrder`
  - **CVE-2026-41650** (GHSA-gh4j-gqv2-49f6, MODERATE) — XML Comment/CDATA injection via unescaped delimiters
  - **CVE-2026-33349** (GHSA-jp2q-39xq-3w4g, MODERATE) — entity expansion limit bypassed when set to `0` (JS falsy-evaluation bug)
- **node-forge** 1.3.3 → 1.4.0 — fixes 4 CVEs:
  - **CVE-2026-33896** (GHSA-2328-f5f3-gj25, HIGH) — `basicConstraints`/RFC 5280 cert-chain validation bypass
  - **CVE-2026-33891** (GHSA-5m6q-g25r-mvwx, HIGH) — DoS via `BigInteger.modInverse(0)` infinite loop
  - **CVE-2026-33894** (GHSA-ppp5-5v6c-4jwp, HIGH) — RSA-PKCS1 v1.5 signature forgery (Bleichenbacher-style)
  - **CVE-2026-33895** (GHSA-q67f-28xg-22rw, HIGH) — Ed25519 signature malleability (missing canonical-scalar check)
- **socket.io-parser** (npm `overrides` pin) 4.2.5 → 4.2.6 — fixes **CVE-2026-33151** (GHSA-677m-j7p3-52f9, HIGH) — unbounded binary attachments DoS
- **drizzle-orm** 0.45.1 → 0.45.2 — fixes **CVE-2026-39356** (GHSA-gpj5-g38j-94v9, HIGH) — SQL injection via improperly escaped SQL identifiers
- **express-rate-limit** 8.2.1 → 8.3.2 — fixes **CVE-2026-30827** (GHSA-46wh-pxpv-q5gq, HIGH) — IPv4-mapped IPv6 addresses bypass per-client rate limiting on dual-stack servers
- **multer** 2.0.2 → 2.1.1 — fixes 3 of 5 CVEs present since multer's introduction in v1.2.1:
  - **CVE-2026-3520** (GHSA-5528-5vmv-3xc2, HIGH) — DoS via uncontrolled recursion
  - **CVE-2026-2359** (GHSA-v52c-386h-88mc, HIGH) — DoS via resource exhaustion
  - **CVE-2026-3304** (GHSA-xf7r-hgr6-v32p, HIGH) — DoS via incomplete cleanup

---

## [1.2.2] - 2026-02-26

### Security

- **Docker**: Fixed container running as root user; adjusted user permissions for safer defaults (#424, #417).
- **SSRF Protection**: Fixed HTTP request SSRF vulnerability (#418).
- **fast-xml-parser**: Upgraded from 5.3.5 to 5.3.7 to address CVE (#416).
- **CI**: Pinned 3rd-party GitHub Actions to commit SHAs (#419).

### Changed

- Added `repository` and `engines` fields to `package.json`.
- Updated CI dependencies: `docker/build-push-action` 6.18.0 → 6.19.2 (#408), `docker/setup-qemu-action` 3.2.0 → 3.7.0 (#409).
- Updated runtime dependencies: `react-hook-form` (#410), `pino` 10.3.0 → 10.3.1 (#412), `@tanstack/react-query` 5.90.20 → 5.90.21 (#413), `dotenv` 17.2.4 → 17.3.1 (#414).
- Updated dev dependencies group (#411).

### Addressed Vulnerabilities

- **fast-xml-parser** 5.3.5 → 5.3.7 — fixes **CVE-2026-26278** (GHSA-jmr7-xgp7-cmfj, HIGH) — DoS via entity expansion in DOCTYPE (no expansion limit).

## [1.2.1] - 2026-02-21

### Added

- **SSL Support**: Added SSL support with optional HTTP to HTTPS redirection (#395).
- **ARM64 Support**: Added ARM64 architecture to CI builds (#388).

### Changed

- HSTS is disabled if SSL is disabled.
- Updated dependencies including `fast-xml-parser`, `semver`, `dotenv` (#378, #379, #380, #381).

### Fixed

- Fixed issue with tracked `sqlite.db` and updated `.gitignore`.

### Addressed Vulnerabilities

- **fast-xml-parser** 5.3.4 → 5.3.5 — fixes **CVE-2026-25896** (GHSA-m7jm-9gc2-mpf2, CRITICAL) — entity-encoding bypass via regex injection in DOCTYPE entity names.

## [1.2.0] - 2026-02-08

- **RSS Feed Support**: Added a dedicated page for RSS feeds with capabilities to manage feeds and view items.
- **xREL Integration**: Implemented integration with xREL.to for game release notifications and metadata.
- **Download Modal Redesign**: Complete redesign of the download dialogs (simple and advanced) for improved usability.
- **Compact View**: Added a density setting to toggle between comfortable and compact list views in Dashboard, Library, and Wishlist.
- **Enhanced Notifications**: Added links to notifications, allowing direct navigation to relevant games or pages.
- **Security hardening**: Introduced protections for SSRF, missing security headers, and improved IPv6 validation.

### Changed

- **Privacy**: Removed Google Fonts dependency for better privacy and offline support.
- **Performance**: Optimized metadata refresh with chunked fetching and improved Prowlarr indexer synchronization.
- **Settings**: Updated settings page with tabbed navigation for better organization.
- **UX**: Enhanced password visibility toggles and accessibility throughout the app.
- **Logging**: Improved log truncation for better performance and privacy.

### Fixed

- Fixed Content Security Policy (CSP) preventing version checks.
- Resolved UI issue where the close button overlaid the cover image in GameCard.
- Fixed timestamp calculation issues affecting notification times.
- Reduced log verbosity for SSL verification errors.

### Addressed Vulnerabilities

- **fast-xml-parser** 5.3.3 → 5.3.4 — fixes **CVE-2026-25128** (GHSA-37qj-frw5-hhjh, HIGH) — RangeError DoS via numeric entities.

## [1.1.0] - 2026-01-19

### Added

- **SQLite Support**: Migrated database engine from PostgreSQL to SQLite for a simpler, "single-file" deployment.
- **Migration Tooling**: Added `docker-compose.migrate.yml` and `pg-to-sqlite.ts` to automatically convert data from old PostgreSQL installations.
- **Improved Docker Experience**: Default environment variables and automatic directory creation for a true "Pull & Run" experience.
- **Migration UI Warning**: Added a prominent banner on the Setup page to prevent users from accidentally skipping the migration process.

### Changed

- Refactored `storage.ts` and `schema.ts` for SQLite compatibility.
- Simplified `docker-compose.yml` (removed PostgreSQL service).
- Updated `README.md` and added `docs/MIGRATION.md` with detailed upgrade instructions.

### Fixed

- Improved reliability of database initialization on fresh installs.

## [1.0.5] - 2026-01-18

### Changed

- Update to docker-compose.yml file to make port a variable throughout.

### Fixed

- Initial setup not working

## [1.0.4] - 2026-01-13

- Initial release of the changelog

### Added

- feat: added links to torrent on indexer if available
- feat: add indexer filtering to download items in GameDownloadDialog
- feat: add indexerName to DownloadItem interface
- feat: add auto sorting functionality for downloaders and indexers based on priority and enabled status
- Add contributors list and shorten readme

### Changed

- refactor: added new max width for download title, aligned tooltip with changes, added underlines on hover to links
- Dep updates
- Update downloader and indexer pages to sort by enabled status, then priority and update disabled style
- feat: update downloader input placeholder to reflect selected type
- Allow IGDB configuration during initial setup, removing the need to edit the .env or docker-compose file.
- Updated deployment workflow
- Improved URL parsing to fix some issues when using external indexers/downloaders
- Refactoring of migration runner for more reliability

### Fixed

- fix: added missing seperator to download modal #312

---

> This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
