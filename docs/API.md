# API Reference

This document describes Questarr's external software interfaces: the REST
API exposed by the Express server, and the real-time events pushed over
Socket.io. It complements [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (system
actors and data flow) and [`docs/SECURITY_ASSESSMENT.md`](SECURITY_ASSESSMENT.md)
(risk assessment).

**Update policy:** re-run documentation generation for the affected route
group whenever `server/routes.ts` changes; manually update the Steam/
PCGamingWiki sections when `server/steam-routes.ts` or
`server/pcgamingwiki-router.ts` change.

## Overview

- **Base URL**: all endpoints are served under `/api` on the same origin as
  the app (default `http://localhost:5000`).
- **Format**: JSON request/response bodies throughout, except file uploads
  (`multipart/form-data` for SSL certificate upload) and the download bundle
  endpoint (`application/zip` response).
- **Authentication**: a JWT bearer token obtained from `POST /api/auth/login`
  (or `POST /api/auth/setup` for the first account), sent as
  `Authorization: Bearer <token>` on subsequent requests. Verified by
  `authenticateToken`/`optionalAuthenticateToken` in `server/auth.ts`. A
  global gate — `app.use("/api", authenticateToken)` in `server/routes.ts` —
  requires a valid JWT for every route registered after it; a small set of
  routes registered earlier remain public (see the Authentication section
  below).
- **Rate limiting**: `generalApiLimiter` (100 req/min/IP) applies to all
  `/api` routes; `authRateLimiter` additionally guards login;
  `sensitiveEndpointLimiter` additionally guards write-heavy/sensitive
  endpoints; `igdbRateLimiter` additionally guards IGDB proxy endpoints. See
  `server/middleware.ts`.

## Authentication

| Method | Path                 | Auth Required                                    | Request Body                                                                                                                                      | Response                                                                                             |
| ------ | -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/status`   | None (public)                                    | —                                                                                                                                                 | `{ hasUsers: boolean }`                                                                              |
| POST   | `/api/auth/setup`    | None (public; blocked once a user exists)        | `{ username: string, password: string, igdbClientId?: string, igdbClientSecret?: string }` — manual type-checking only, not express-validator/Zod | `{ token, user: { id, username } }`; 403 if setup already completed; 400 on invalid input            |
| POST   | `/api/auth/login`    | `authRateLimiter` (20 req / 15 min)              | `{ username: string, password: string }` — manual type-checking only, no express-validator/Zod schema                                             | `{ token, user: { id, username } }`; 401 on invalid credentials                                      |
| GET    | `/api/auth/me`       | `authenticateToken` (JWT)                        | —                                                                                                                                                 | `{ id, username, steamId64 }`                                                                        |
| PATCH  | `/api/auth/password` | `authenticateToken` + `sensitiveEndpointLimiter` | `{ currentPassword: string, newPassword: string }` — validated via Zod `updatePasswordSchema`                                                     | `{ success: true, message }`; 401 if current password wrong; 400 `{ error, details }` on Zod failure |

`/api/auth/setup` and `/api/auth/login` are the two security-sensitive
endpoints that rely on inline `typeof` checks plus manual length/`if`
validation instead of an express-validator chain or a Zod schema (see the
risk register in `docs/SECURITY_ASSESSMENT.md`). `/api/auth/password` uses a
proper Zod schema (`updatePasswordSchema`).

Routes registered before the global `authenticateToken` gate (`server/routes.ts`,
before the auth-gate line) are public unless they explicitly list
`authenticateToken`: `/api/auth/*`, `/api/health`, `/api/settings/ssl`
(GET/PATCH), `/api/settings/ssl/generate`, `/api/settings/ssl/upload`,
`/api/system/filesystem`, `/api/config`. Everything registered after that
line — including `/api/ready` and every resource group below — requires a
JWT even where a table row doesn't repeat `authenticateToken`.

## Games

| Method | Path                                   | Auth Required                                                                               | Request Body                                                                                                                                                                                      | Response                                                                                |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/games`                           | JWT (global gate)                                                                           | Query: `search?`, `includeHidden?`, `status?` (comma-separated or array)                                                                                                                          | `Game[]`                                                                                |
| GET    | `/api/games/status/:status`            | JWT                                                                                         | Query: `includeHidden?`                                                                                                                                                                           | `Game[]`                                                                                |
| GET    | `/api/games/search`                    | JWT + `sanitizeSearchQuery`, `validateRequest`                                              | Query: `q` (1–200 chars, required), `search?` (≤200), `limit?` (1–100)                                                                                                                            | `Game[]`; 400 if `q` missing                                                            |
| POST   | `/api/games`                           | JWT + `sensitiveEndpointLimiter`, `sanitizeGameData`, `validateRequest`                     | `{ title (1–500), igdbId?, summary? (≤5000), coverUrl? (URL), releaseDate? (YYYY-MM-DD), rating? (0–10), platforms?, genres?, publishers?, developers? }`, re-parsed via `insertGameSchema` (Zod) | 201 `Game`; 409 `{ error, game }` if duplicate; 400 `{ error, details }` on Zod failure |
| PATCH  | `/api/games/:id/status`                | JWT + `sensitiveEndpointLimiter`, `sanitizeGameId`, `sanitizeGameStatus`, `validateRequest` | `{ status: "wanted"\|"owned"\|"completed"\|"downloading" }` via `updateGameStatusSchema`                                                                                                          | Updated `Game`; 404 if not found                                                        |
| PATCH  | `/api/games/:id/hidden`                | JWT + `sensitiveEndpointLimiter`, `sanitizeGameId`, `validateRequest`                       | `{ hidden: boolean }` via `updateGameHiddenSchema`                                                                                                                                                | Updated `Game`; 404 if not found                                                        |
| PATCH  | `/api/games/:id/user-rating`           | JWT + `sensitiveEndpointLimiter`, `sanitizeGameId`, `validateRequest`                       | `{ userRating: number\|null }` (0.5–10, step 0.5) via `updateGameUserRatingSchema`                                                                                                                | Updated `Game`; 404 if not found                                                        |
| POST   | `/api/games/refresh-metadata`          | JWT + `igdbRateLimiter`                                                                     | —                                                                                                                                                                                                 | `{ success, message, updatedCount, errorCount }`                                        |
| DELETE | `/api/games/:id`                       | JWT + `sensitiveEndpointLimiter`, `sanitizeGameId`, `validateRequest`                       | —                                                                                                                                                                                                 | 204 No Content; 404 if not found                                                        |
| GET    | `/api/games/:id/downloads`             | JWT + `sanitizeGameId`, `validateRequest` (verifies game ownership)                         | —                                                                                                                                                                                                 | `GameDownload[]`; 404 game not found, 403 not owner                                     |
| GET    | `/api/games/discover`                  | JWT + `igdbRateLimiter`                                                                     | Query: `limit?`                                                                                                                                                                                   | `Game[]` (IGDB-formatted recommendations)                                               |
| POST   | `/api/games/match-and-add`             | JWT                                                                                         | `{ title: string }` — manual `typeof` check, no validator                                                                                                                                         | 201 `Game`; 404 if no IGDB match; 409 if already in collection                          |
| POST   | `/api/games/:gameId/blacklist`         | JWT (explicit)                                                                              | `{ releaseTitle: string (required, ≤500) }` via `insertReleaseBlacklistSchema.safeParse`                                                                                                          | 201 blacklist entry; 400 invalid; 403/404 via ownership check                           |
| GET    | `/api/games/:gameId/blacklist`         | JWT (explicit)                                                                              | —                                                                                                                                                                                                 | Blacklist entries array; 403/404 via ownership check                                    |
| DELETE | `/api/games/:gameId/blacklist/:id`     | JWT (explicit)                                                                              | —                                                                                                                                                                                                 | 204; 404 if entry not found                                                             |
| DELETE | `/api/games/:id/downloads/:downloadId` | JWT + `sanitizeGameId`, `sanitizeDownloadId`, `validateRequest`                             | —                                                                                                                                                                                                 | `{ success: true }`; 404 if game/download not found                                     |

## Downloads

| Method | Path                     | Auth Required                                                                         | Request Body                                                                                                                             | Response                                                                                                                            |
| ------ | ------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/downloads`         | JWT (global gate)                                                                     | —                                                                                                                                        | `{ downloads: (Download & { downloaderId, downloaderName, trackedByQuestarr, downloaderCategory })[], errors: {...}[] }`            |
| GET    | `/api/downloads/summary` | JWT (explicit)                                                                        | —                                                                                                                                        | Per-game download summary object                                                                                                    |
| GET    | `/api/downloads/scan`    | JWT (explicit)                                                                        | —                                                                                                                                        | `{ groups: { baseTitle, downloads[], libraryMatch: {game, confidence}\|null }[] }` — untracked downloads grouped/matched to library |
| POST   | `/api/downloads/claim`   | JWT (explicit)                                                                        | `{ downloaderId, downloadHash, downloadTitle, currentStatus, category, gameId? or newGame? }` via `claimDownloadRequestSchema.safeParse` | `{ success: true, gameId }`; 409 if already linked; 400/404 on invalid input                                                        |
| POST   | `/api/downloads`         | JWT + `sensitiveEndpointLimiter`, `sanitizeDownloaderDownloadData`, `validateRequest` | `{ url (http/https/magnet), title (1–500), category?, downloadPath? (no ".."), priority? (0–10), gameId? (uuid), downloadType? }`        | Add-with-fallback result across enabled downloaders; 400 if none configured; 500 on total failure                                   |
| POST   | `/api/downloads/bundle`  | JWT + `sensitiveEndpointLimiter`                                                      | `{ downloads: { link, title, downloadType? }[] }` — manual array check only                                                              | Streams a `.zip` of fetched torrent/nzb files                                                                                       |

## Downloaders

| Method | Path                                                 | Auth Required                                                                         | Request Body                                                                                                                                                                                                                                              | Response                                                                        |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/downloaders`                                   | JWT                                                                                   | —                                                                                                                                                                                                                                                         | `Downloader[]` (passwords masked as `********`)                                 |
| GET    | `/api/downloaders/enabled`                           | JWT                                                                                   | —                                                                                                                                                                                                                                                         | `Downloader[]` (masked)                                                         |
| GET    | `/api/downloaders/storage`                           | JWT                                                                                   | —                                                                                                                                                                                                                                                         | `{ downloaderId, downloaderName, freeSpace, error? }[]`, cached 30s server-side |
| GET    | `/api/downloaders/:id`                               | JWT                                                                                   | —                                                                                                                                                                                                                                                         | `Downloader` (masked); 404 if not found                                         |
| POST   | `/api/downloaders`                                   | JWT + `sensitiveEndpointLimiter`, `sanitizeDownloaderData`, `validateRequest`         | `{ name (1–200), type (transmission\|rtorrent\|qbittorrent\|sabnzbd\|nzbget), url (full URL or bare hostname/IP), username?, password?, enabled?, downloadPath? (no ".."), label?, urlPath? }` via `insertDownloaderSchema`; SSRF-checked via `isSafeUrl` | 201 `Downloader` (masked); 400 invalid/unsafe URL                               |
| PATCH  | `/api/downloaders/:id`                               | JWT + `sensitiveEndpointLimiter`, `sanitizeDownloaderUpdateData`, `validateRequest`   | Partial of above plus `priority?`, `category?`; `password` equal to the redacted placeholder = keep unchanged                                                                                                                                             | Updated `Downloader` (masked); 404 if not found                                 |
| DELETE | `/api/downloaders/:id`                               | JWT + `sensitiveEndpointLimiter`                                                      | —                                                                                                                                                                                                                                                         | 204; 404 if not found                                                           |
| POST   | `/api/downloaders/test`                              | JWT                                                                                   | `{ type, url, port?, useSsl?, urlPath?, username?, password?, downloadPath?, category?, label?, ... }` — manual checks, SSRF-checked                                                                                                                      | Connection test result object                                                   |
| POST   | `/api/downloaders/:id/test`                          | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Connection test result for saved downloader; 404 if not found                   |
| POST   | `/api/downloaders/:id/downloads`                     | JWT + `sensitiveEndpointLimiter`, `sanitizeDownloaderDownloadData`, `validateRequest` | `{ url, title, category?, downloadPath?, priority?, downloadType? }`                                                                                                                                                                                      | Add-download result; 404 downloader not found; 400 if downloader disabled       |
| GET    | `/api/downloaders/:id/downloads`                     | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Downloads array from that client; 404 if downloader not found                   |
| GET    | `/api/downloaders/:id/downloads/:downloadId`         | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Single download status object; 404 if not found                                 |
| GET    | `/api/downloaders/:id/downloads/:downloadId/details` | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Detailed info (files, trackers); 404 if not found                               |
| POST   | `/api/downloaders/:id/downloads/:downloadId/pause`   | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Pause result object                                                             |
| POST   | `/api/downloaders/:id/downloads/:downloadId/resume`  | JWT                                                                                   | —                                                                                                                                                                                                                                                         | Resume result object                                                            |
| DELETE | `/api/downloaders/:id/downloads/:downloadId`         | JWT                                                                                   | Query: `deleteFiles?`                                                                                                                                                                                                                                     | Removal result object                                                           |

## Indexers

| Method | Path                           | Auth Required                                                                                                                                                                | Request Body                                                                                                                                            | Response                                                                        |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/indexers`                | JWT                                                                                                                                                                          | —                                                                                                                                                       | `Indexer[]` (apiKey masked)                                                     |
| GET    | `/api/indexers/enabled`        | JWT                                                                                                                                                                          | —                                                                                                                                                       | `Indexer[]` (masked)                                                            |
| GET    | `/api/indexers/search`         | JWT (registered after the global auth gate, so `optionalAuthenticateToken` never actually sees an unauthenticated request) + `sanitizeIndexerSearchQuery`, `validateRequest` | Query: `query` (1–200, required), `category?`/`cat?` (≤500), `limit?` (1–100), `offset?` (≥0), `gameId?`                                                | `{ items, total, offset, blacklistedCount?, errors? }`                          |
| GET    | `/api/indexers/:id`            | JWT                                                                                                                                                                          | —                                                                                                                                                       | `Indexer` (masked); 404 if not found                                            |
| POST   | `/api/indexers`                | JWT + `sensitiveEndpointLimiter`, `sanitizeIndexerData`, `validateRequest`                                                                                                   | `{ name (1–200), url (http/https, SSRF-checked), apiKey? (≤500), protocol? (torznab\|newznab), enabled? }` via `insertIndexerSchema`                    | 201 `Indexer` (masked); 400 invalid/unsafe URL                                  |
| PATCH  | `/api/indexers/:id`            | JWT + `sensitiveEndpointLimiter`, `sanitizeIndexerUpdateData`, `validateRequest`                                                                                             | Partial: `name?, url?, apiKey?, protocol?, enabled?, priority? (≥1), categories?, rssEnabled?, autoSearchEnabled?`; apiKey placeholder = keep unchanged | Updated `Indexer` (masked); 404 if not found                                    |
| DELETE | `/api/indexers/:id`            | JWT + `sensitiveEndpointLimiter`                                                                                                                                             | —                                                                                                                                                       | 204; 404 if not found                                                           |
| POST   | `/api/indexers/test`           | JWT                                                                                                                                                                          | `{ name?, url (required, SSRF-checked), apiKey (required), enabled?, priority?, categories?, rssEnabled?, autoSearchEnabled? }` — manual checks only    | Torznab connection test result                                                  |
| POST   | `/api/indexers/:id/test`       | JWT                                                                                                                                                                          | —                                                                                                                                                       | Connection test result for saved indexer; 404 if not found                      |
| GET    | `/api/indexers/:id/categories` | JWT                                                                                                                                                                          | —                                                                                                                                                       | Category list from indexer; 404 if not found                                    |
| GET    | `/api/indexers/:id/search`     | JWT                                                                                                                                                                          | Query: `query` (required), `category?`/`cat?`, `limit?` (default 50), `offset?` (default 0)                                                             | Search results from that single indexer; 400 if query missing, 404 if not found |
| POST   | `/api/indexers/prowlarr/sync`  | JWT + `sensitiveEndpointLimiter`                                                                                                                                             | `{ url: string, apiKey: string }` — manual checks, SSRF-checked                                                                                         | `{ success, message, results }`                                                 |
| GET    | `/api/search`                  | JWT (same global-gate note as above; alias of `/api/indexers/search`) + `sanitizeIndexerSearchQuery`, `validateRequest`                                                      | Same as `/api/indexers/search`                                                                                                                          | Same as `/api/indexers/search`                                                  |

## IGDB

| Method | Path                           | Auth Required                                                     | Request Body                                             | Response                                                                                |
| ------ | ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/igdb/search`             | JWT + `igdbRateLimiter`, `sanitizeSearchQuery`, `validateRequest` | Query: `q` (1–200, required), `limit?` (1–100)           | Formatted IGDB game array                                                               |
| GET    | `/api/igdb/popular`            | JWT + `igdbRateLimiter`                                           | Query: `limit?`                                          | Formatted game array; `Cache-Control: public, max-age=3600, stale-while-revalidate=600` |
| GET    | `/api/igdb/recent`             | JWT + `igdbRateLimiter`                                           | Query: `limit?`                                          | Formatted game array; same cache header                                                 |
| GET    | `/api/igdb/upcoming`           | JWT + `igdbRateLimiter`                                           | Query: `limit?`                                          | Formatted game array; same cache header                                                 |
| GET    | `/api/igdb/genre/:genre`       | JWT + `igdbRateLimiter`                                           | Path `:genre` (≤100 chars); query `limit?`, `offset?`    | Formatted game array; same cache header                                                 |
| GET    | `/api/igdb/platform/:platform` | JWT + `igdbRateLimiter`                                           | Path `:platform` (≤100 chars); query `limit?`, `offset?` | Formatted game array; same cache header                                                 |
| GET    | `/api/igdb/genres`             | JWT + `igdbRateLimiter`                                           | —                                                        | Genre list; `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`         |
| GET    | `/api/igdb/platforms`          | JWT + `igdbRateLimiter`                                           | —                                                        | Platform list; same 24h cache header                                                    |
| GET    | `/api/igdb/game/:id`           | JWT + `igdbRateLimiter`, `sanitizeIgdbId`, `validateRequest`      | Path `:id` (positive integer)                            | Formatted IGDB game; 404 if not found                                                   |

## Settings

| Method | Path                         | Auth Required                                               | Request Body                                                                                                                                                | Response                                                                                       |
| ------ | ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/settings/ssl`          | `authenticateToken` (pre-gate)                              | —                                                                                                                                                           | SSL config plus optional `certInfo` (subject, issuer, validity, selfSigned)                    |
| PATCH  | `/api/settings/ssl`          | `authenticateToken` + `sensitiveEndpointLimiter` (pre-gate) | `{ enabled: boolean, port: number, certPath?, keyPath?, redirectHttp? }` — manual checks; cert/key paths path-traversal checked against `FILE_BROWSER_ROOT` | `{ success, message }`; 400/403 on invalid config or disallowed path                           |
| POST   | `/api/settings/ssl/generate` | `authenticateToken` + `sensitiveEndpointLimiter` (pre-gate) | —                                                                                                                                                           | `{ success, message, certPath, keyPath }` (self-signed cert)                                   |
| POST   | `/api/settings/ssl/upload`   | `authenticateToken` + `sensitiveEndpointLimiter` (pre-gate) | Multipart form: `cert` file + `key` file (5 MB limit, memory storage); validated as PEM                                                                     | `{ success, message, certPath, keyPath }`; 400 if missing/invalid PEM                          |
| GET    | `/api/system/filesystem`     | `authenticateToken` + `sensitiveEndpointLimiter` (pre-gate) | Query: `path?` (relative; absolute paths/NUL bytes rejected; confined to `FILE_BROWSER_ROOT`)                                                               | `{ path, parent, files: {name, path, isDirectory, size}[] }`; 403 on traversal, 404 if missing |
| GET    | `/api/config`                | `sensitiveEndpointLimiter` only, no JWT (pre-gate, public)  | —                                                                                                                                                           | `{ igdb: { configured, source }, xrel: { apiBase } }`                                          |
| GET    | `/api/settings/igdb`         | JWT + `sensitiveEndpointLimiter`                            | —                                                                                                                                                           | `{ configured, source, clientId }`                                                             |
| POST   | `/api/settings/igdb`         | JWT + `sensitiveEndpointLimiter`                            | `{ clientId: string (required), clientSecret?: string }` — manual checks; redacted-placeholder secret = keep existing                                       | `{ success: true }`; 400 if client secret required but missing                                 |
| GET    | `/api/settings/discord`      | JWT + `sensitiveEndpointLimiter`                            | —                                                                                                                                                           | `{ configured: boolean, webhookUrl?: "********" }`                                             |
| POST   | `/api/settings/discord`      | JWT + `sensitiveEndpointLimiter`                            | `{ webhookUrl?: string }` — must be a `discord.com`/`discordapp.com` webhook URL; redacted placeholder = keep unchanged                                     | `{ success: true }`; 400 on invalid webhook URL                                                |
| GET    | `/api/settings`              | JWT                                                         | —                                                                                                                                                           | `UserSettings` (created with defaults if none exist)                                           |
| PATCH  | `/api/settings`              | JWT                                                         | Validated via `updateUserSettingsSchema` (Zod)                                                                                                              | Updated `UserSettings`; 400 `{ error, details }` on Zod failure                                |
| PATCH  | `/api/settings/xrel`         | JWT                                                         | `{ apiBase?: string (http/https, SSRF-checked, must match ALLOWED_XREL_DOMAINS), xrelSceneReleases?: boolean, xrelP2pReleases?: boolean }` — manual checks  | `{ success, xrel: { apiBase }, settings? }`; 400 on invalid/unsafe/unauthorized domain         |
| GET    | `/api/settings/nexusmods`    | JWT + `sensitiveEndpointLimiter`                            | —                                                                                                                                                           | `{ configured: boolean, source?: "env"\|"database" }`                                          |
| POST   | `/api/settings/nexusmods`    | JWT + `sensitiveEndpointLimiter`                            | `{ apiKey: string (required) }`                                                                                                                             | `{ success: true }`; 400 if missing                                                            |

## RSS

| Method | Path                 | Auth Required | Request Body                                                | Response                                                                      |
| ------ | -------------------- | ------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/rss/feeds`     | JWT           | —                                                           | `RssFeed[]`                                                                   |
| POST   | `/api/rss/feeds`     | JWT           | Validated via `insertRssFeedSchema` (Zod); URL SSRF-checked | 201 `RssFeed`; 400 on Zod/unsafe-URL failure (triggers async initial refresh) |
| PUT    | `/api/rss/feeds/:id` | JWT           | Partial `insertRssFeedSchema`                               | Updated `RssFeed`; 404 if not found; 400 if unsafe URL                        |
| DELETE | `/api/rss/feeds/:id` | JWT           | —                                                           | 204; 404 if not found                                                         |
| GET    | `/api/rss/items`     | JWT           | Query: `limit?` (default 100)                               | `RssFeedItem[]`                                                               |
| POST   | `/api/rss/refresh`   | JWT           | —                                                           | `{ success: true }` (triggers refresh of all feeds)                           |

## Notifications

| Method | Path                              | Auth Required  | Request Body                                   | Response                                                             |
| ------ | --------------------------------- | -------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/notifications`              | JWT (explicit) | Query: `limit?` (default 50)                   | `Notification[]`                                                     |
| GET    | `/api/notifications/unread-count` | JWT (explicit) | —                                              | `{ count: number }`                                                  |
| POST   | `/api/notifications`              | JWT (explicit) | Validated via `insertNotificationSchema` (Zod) | 201 `Notification` (also emitted over Socket.io); 400 on Zod failure |
| PUT    | `/api/notifications/:id/read`     | JWT (explicit) | —                                              | Updated `Notification`; 404 if not found                             |
| PUT    | `/api/notifications/read-all`     | JWT (explicit) | —                                              | `{ success: true }`                                                  |
| DELETE | `/api/notifications`              | JWT (explicit) | —                                              | 204 (clears all read notifications)                                  |

## xREL

| Method | Path               | Auth Required | Request Body                                                                                            | Response                                                                                                 |
| ------ | ------------------ | ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/api/xrel/latest` | JWT           | Query: `page?` (default 1)                                                                              | `{ ...xrelResult, list: [...releases annotated with libraryStatus, gameId, isWanted, matchCandidate?] }` |
| GET    | `/api/xrel/search` | JWT           | Query: `q` (required), `scene?` (default true unless "false"/"0"), `p2p?`, `limit?` (1–100, default 25) | `{ results: [...] }`; 400 if `q` missing                                                                 |

`PATCH /api/settings/xrel` (xREL API base URL and scene/P2P release
preferences) is documented under [Settings](#settings).

## NexusMods

| Method | Path                           | Auth Required | Request Body                                            | Response                                                              |
| ------ | ------------------------------ | ------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/nexusmods/game-domain`   | JWT           | Query: `title` (required)                               | `{ configured: boolean, domain: string\|null }`; 400 if title missing |
| GET    | `/api/nexusmods/trending-mods` | JWT           | Query: `domain` (required), `limit?` (1–20, default 10) | Trending mods array; 400 if domain missing                            |

NexusMods API-key configuration (`GET`/`POST /api/settings/nexusmods`) is
documented under [Settings](#settings).

## Stats

| Method | Path                       | Auth Required | Request Body                                                                                                                                | Response                                                                                  |
| ------ | -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/api/stats/discord-share` | JWT           | `{ image: string (data URI, png/jpeg/gif/webp base64), message?: string }` — manual checks; webhook URL must match Discord's domain pattern | `{ success: true }`; 400 on missing/invalid config or image; 502 if Discord request fails |

## Health / Ready / Config

| Method | Path          | Auth Required                                                                                       | Request Body | Response                                                                               |
| ------ | ------------- | --------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| GET    | `/api/health` | None (public, pre-gate)                                                                             | —            | `{ status: "ok" }` (liveness probe only, no dependency checks)                         |
| GET    | `/api/ready`  | JWT (registered after the global auth gate, so a token is required despite being a readiness probe) | —            | `{ status: "ok" }` (200) if DB + IGDB checks succeed, else `{ status: "error" }` (503) |
| GET    | `/api/config` | `sensitiveEndpointLimiter` only, no JWT (public, pre-gate)                                          | —            | `{ igdb: { configured, source }, xrel: { apiBase } }`                                  |

## HowLongToBeat

| Method | Path               | Auth Required  | Request Body              | Response                                             |
| ------ | ------------------ | -------------- | ------------------------- | ---------------------------------------------------- |
| GET    | `/api/hltb/lookup` | JWT (explicit) | Query: `title` (required) | `{ data: HltbResult \| null }`; 400 if title missing |

## Blacklist

| Method | Path             | Auth Required  | Request Body | Response                                                             |
| ------ | ---------------- | -------------- | ------------ | -------------------------------------------------------------------- |
| GET    | `/api/blacklist` | JWT (explicit) | —            | All blacklist entries across the user's games (`ReleaseBlacklist[]`) |

Per-game blacklist management (`POST`/`GET`/`DELETE /api/games/:gameId/blacklist*`)
is documented under [Games](#games).

## Steam

`server/steam-routes.ts` — 2 routes, mounted directly on the app (no prefix
router), both behind the global auth gate plus explicit `authenticateToken`.

| Method | Path                       | Auth Required | Request Body                                                                                               | Response                                                                                                 |
| ------ | -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PATCH  | `/api/user/steam-id`       | JWT           | `{ steamId: string }` — must be a 17-digit SteamID64 starting with `7656` (`steamService.validateSteamId`) | `{ success: true, steamId }`; 400 if missing/invalid format                                              |
| POST   | `/api/steam/wishlist/sync` | JWT           | —                                                                                                          | `{ success, addedCount, games }` (via `syncUserSteamWishlist`); 400 if Steam ID not linked or sync fails |

## PCGamingWiki

`server/pcgamingwiki-router.ts` — 1 route.

| Method | Path                         | Auth Required | Request Body                                     | Response                                                                                                   |
| ------ | ---------------------------- | ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/external/pcgamingwiki` | JWT           | Query: `steamAppId` (required, positive integer) | `{ url: string \| null }`; 400 if `steamAppId` missing/invalid; result cached 24h (5min on lookup failure) |

## Error Format

Across handlers, error responses follow one of these consistent shapes:

- **Validation failures (express-validator chains)**: the shared
  `validateRequest` middleware (`server/middleware.ts`) runs after any
  `sanitize*` validator array. On failure it returns HTTP 400 with:
  ```json
  {
    "error": "Validation failed",
    "details": [
      /* express-validator error objects: { type, msg, path, location, value } */
    ]
  }
  ```
- **Validation failures (Zod schemas)**: handlers that call
  `someSchema.parse(req.body)` catch `z.ZodError` directly and return HTTP
  400 with:
  ```json
  {
    "error": "Invalid <thing> data",
    "details": [
      /* ZodError.errors array */
    ]
  }
  ```
  (message text varies per handler, e.g. "Invalid game data", "Invalid
  status data", "Invalid settings data")
- **Ad hoc business-logic errors**: most handlers return a plain
  `{ "error": "<message>" }` object directly for 400/401/403/404/409/502
  cases (sometimes with an extra field attached, e.g. `{ error, game }` on a
  duplicate-game 409), without going through shared middleware.
- **Uncaught/rethrown errors (global handler)**: routes that call
  `next(error)` fall through to `errorHandler` (`server/middleware.ts`),
  which returns:
  ```json
  {
    "error": "<message, or 'Internal Server Error' in production for 5xx>",
    "details": "<only if err.details was set>"
  }
  ```
  Status comes from `err.status`/`err.statusCode`, defaulting to 500. In
  production, 5xx messages are sanitized to `"Internal Server Error"` to
  avoid leaking internals; 4xx messages pass through as-is. All errors are
  logged via Pino with method/path context — `error` level for 5xx, `warn`
  otherwise.
- **No-content success**: several `DELETE` endpoints return `204 No Content`
  with an empty body rather than a JSON payload (e.g. `DELETE /api/games/:id`,
  `DELETE /api/indexers/:id`, `DELETE /api/downloaders/:id`,
  `DELETE /api/rss/feeds/:id`, `DELETE /api/notifications`).

## Real-time interface (Socket.io)

Alongside the REST API, the server pushes real-time events over Socket.io
(`server/socket.ts`). See [`docs/ARCHITECTURE.md` §6](ARCHITECTURE.md#6-out-of-band-channel-socketio)
for the full actor/data-flow explanation. Summary:

| Event            | Emitted from                                                                                     | Payload               | Consumed by                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------- |
| `notification`   | `cron.ts` (game updates, download completion, auto-search results, xREL matches) and `routes.ts` | `Notification` object | `client/src/components/NotificationCenter.tsx` |
| `downloadUpdate` | `cron.ts::checkDownloadStatus`                                                                   | `gameId: string`      | `client/src/components/GameDetailsModal.tsx`   |

Both events are broadcast to every connected socket (`io.emit`) — there are
no per-user rooms yet.
