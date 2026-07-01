# Secrets & Credentials Management

This document describes every place Questarr stores or handles sensitive
values — environment configuration, third-party API credentials, and the
indexer/downloader/user credentials that users enter through the app — how
access to them is controlled, and how they get rotated. It reflects the
current state of the code; gaps are called out explicitly rather than
glossed over.

## 1. Environment variables

All configuration is optional; sensible defaults are used when a variable
is unset. See [`.env.example`](../.env.example) for the canonical template.
`.env` is loaded once via `dotenv/config` at `server/index.ts:2` and parsed
against a Zod schema in `server/config.ts:10-45`. If any variable fails
validation, the server logs the error and exits (`server/config.ts:50-63`)
rather than starting with an invalid configuration.

| Variable                                | Purpose                                         | Required?                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                            | Signs/verifies session JWTs                     | No — auto-generated and persisted to the DB if unset (§2)                                                                                                                                                                     |
| `NEXUSMODS_API_KEY`                     | NexusMods mod lookups                           | No — validated by `envSchema`; can be set later in Settings → Services (§3)                                                                                                                                                   |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch/IGDB OAuth for game metadata & discovery | No env-wise, but one of env/DB must be set for discovery to work                                                                                                                                                              |
| `PORT`                                  | HTTP port                                       | No (default `5000`)                                                                                                                                                                                                           |
| `HOST`                                  | Bind address                                    | No — **defaults to `0.0.0.0` (all interfaces) in every deployment mode**, not just Docker (`server/config.ts:41`). Set `HOST=127.0.0.1` explicitly if you don't want the server reachable from other machines on the network. |
| `NODE_ENV`                              | `development` \| `production` \| `test`         | No (defaults to `production`)                                                                                                                                                                                                 |
| `SQLITE_DB_PATH`                        | Path to the SQLite database file                | No (default `sqlite.db`)                                                                                                                                                                                                      |

A legacy hardcoded default, `"questarr-default-secret-change-me"`, is
explicitly rejected by a Zod `.refine()` (`server/config.ts:18-24`) so the
app can never silently run with that well-known value.

The `.env` file itself is git-ignored (see `.gitignore`) and must never be
committed. `docker-compose*.local.yml` and `gha-creds-*.json` are ignored
for the same reason.

## 2. Authentication secret (`JWT_SECRET`)

Session tokens are signed HS256 JWTs (`jsonwebtoken`), 7-day expiry
(`server/auth.ts:77-82`), verified on every authenticated request by
`authenticateToken` / `optionalAuthenticateToken` (`server/auth.ts:88-126`).

Resolution order for the signing secret, `getJwtSecret()`
(`server/auth.ts:13-67`):

1. In-memory cache for the life of the process.
2. `JWT_SECRET` environment variable.
3. Value stored in the `system_config` table under key `jwt_secret`.
4. If none of the above exist, generate 64 random bytes
   (`crypto.randomBytes(64).toString("hex")`) and persist them to
   `system_config` for future restarts.

If DB persistence fails (e.g. read-only filesystem), the generated secret
is still used in memory for that process, but a warning is logged since it
won't survive a restart and will invalidate all sessions when it does.

**Rotation:** there is no dedicated "rotate JWT secret" endpoint. To force
all users to re-authenticate, either set/change the `JWT_SECRET` env var,
or delete the `jwt_secret` row from `system_config` — a new one will be
generated automatically on next use. Either action invalidates every
existing session.

## 3. Third-party API credentials

| Service                                          | Where configured                                                      | Storage                                                                                                                             | Refresh/rotation                                                                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IGDB** (via Twitch OAuth)                      | `.env` (`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`) or Settings → Services | DB `system_config` keys `igdb.clientId` / `igdb.clientSecret` take priority over env if both are present (`server/igdb.ts:138-153`) | Twitch access token is fetched via `client_credentials` grant and cached in memory, auto-refreshed ~1 minute before expiry (`server/igdb.ts:187-214`). Client ID/secret themselves are user-rotated via the Settings UI. |
| **NexusMods**                                    | `.env` (`NEXUSMODS_API_KEY`) or Settings → Services                   | DB `system_config` key `nexusmods.apiKey`; client reconfigured in-memory on save (`server/nexusmods.ts:45-68,175-181`)              | Manual — overwrite the key in Settings.                                                                                                                                                                                  |
| **HowLongToBeat**, **PCGamingWiki**, **xREL.to** | N/A                                                                   | N/A                                                                                                                                 | These are unauthenticated public APIs; no credentials involved.                                                                                                                                                          |
| **Steam** wishlist import                        | N/A (public Steam endpoints + user's `steamId64`)                     | N/A                                                                                                                                 | N/A                                                                                                                                                                                                                      |
| **Discord** notification webhook                 | Settings → Services                                                   | DB `system_config` key `discord.webhookUrl`, plaintext (`server/routes.ts:2747-2776`)                                               | Manual — overwrite the URL in Settings.                                                                                                                                                                                  |

The IGDB and NexusMods settings endpoints are the model for how credential
endpoints should behave: `GET /api/settings/igdb` returns the `clientId`
but **never** the `clientSecret`; updating the secret without changing the
ID is done by sending the sentinel string `"********"` for the unchanged
field (`server/routes.ts:2687-2743`). `GET /api/settings/nexusmods` returns
only `{ configured, source }` booleans, never the key itself
(`server/routes.ts:3282-3313`).

The **Discord webhook URL does not get this treatment**: a Discord webhook
URL embeds the secret token needed to post to the channel, but
`GET /api/settings/discord` (`server/routes.ts:2747-2758`) returns it
unredacted, and neither the GET nor POST handler is behind
`sensitiveEndpointLimiter`. This has the same exposure profile as the
indexer/downloader credentials in §4, and should get the same masked-GET
treatment as IGDB/NexusMods.

## 4. User-entered indexer & downloader credentials

This is the largest surface of stored secrets: Torznab/Newznab indexer API
keys, and usernames/passwords for download clients (qBittorrent,
Transmission, rTorrent, sabnzbd, nzbget).

- **Storage:** plaintext columns in SQLite —
  `indexers.apiKey` and `downloaders.username` / `downloaders.password`
  (`shared/schema.ts:90-107,109-134`). `server/storage.ts` reads and writes
  these fields as-is; there is no encryption-at-rest, hashing, or
  obfuscation applied anywhere in the storage layer.
- **In transit to the indexer/download client:** credentials are used
  directly to build request auth — HTTP Basic Auth (base64, not
  encryption) for qBittorrent/Transmission-style clients
  (`server/downloaders.ts:811-816,1579-1618`), and RFC 2617 Digest Auth
  challenge-response for rTorrent (`server/downloaders.ts:1457-1506`).
- **Access control:** every indexer/downloader route sits behind the
  global `authenticateToken` middleware (`server/routes.ts:809-817`), so an
  unauthenticated caller cannot read them. However, **any logged-in user
  can retrieve them in full** — `GET /api/indexers`, `GET /api/indexers/:id`,
  `GET /api/downloaders`, and `GET /api/downloaders/:id`
  (`server/routes.ts:1515-1626,1631-1801`) return the raw `apiKey` /
  `password` fields unredacted in the JSON response. Questarr is a
  single/home-user app without per-user role scoping, so this is a real
  exposure to anyone with an account, or to anything that can read
  browser network traffic/devtools on a shared machine.
- **Rotation:** plain overwrite via `PATCH /api/indexers/:id` /
  `PATCH /api/downloaders/:id` — there's no masking convention here (unlike
  IGDB), which is consistent with the GETs already returning raw values.

### Recommended hardening (not yet implemented)

If tightened credential handling is a priority, in rough priority order:

1. Redact `apiKey` / `password` in the indexer/downloader `GET` responses
   (mirroring the IGDB/NexusMods masked-sentinel pattern), and only accept
   a real value on write when it differs from the sentinel.
2. Encrypt `apiKey` / `password` / `username` at rest (e.g. AES-256-GCM
   with a key derived from `JWT_SECRET` or a dedicated
   `CREDENTIALS_ENCRYPTION_KEY`), decrypting only when building outbound
   requests.
3. Apply the same masked-GET treatment to the Discord webhook URL (§3).

## 5. User account passwords

`users.passwordHash` (`shared/schema.ts:6-11`) never stores plaintext.
Hashing uses `bcryptjs` with `SALT_ROUNDS = 10` (`server/auth.ts:1,10,69-75`).
Passwords are hashed on signup (`server/routes.ts:297`), verified on login
(`server/routes.ts:357-359`), and the password-change endpoint requires the
current password before accepting a new one
(`server/routes.ts:380-407`).

## 6. Rate limiting around credentials (`server/middleware.ts`)

| Limiter                    | Limit                     | Applied to                                                                                       |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `authRateLimiter`          | 20 requests / 15 min / IP | `POST /api/auth/login`                                                                           |
| `sensitiveEndpointLimiter` | 30 requests / min / IP    | Indexer/downloader writes, password change, IGDB/NexusMods settings, SSL settings, Prowlarr sync |
| `generalApiLimiter`        | 100 requests / min / IP   | General fallback                                                                                 |

There is no account lockout beyond the IP-based `authRateLimiter` window
for repeated failed logins.

## 7. Version control hygiene

Secret-bearing files are excluded via `.gitignore`: `.env`, `sqlite.db*`,
`data/*`, `data_test/`, `.sofa/` (SOFA agent credentials —
see `.claude/sofa-skill.md`), and `gha-creds-*.json`. No `.env` or database
file is currently tracked in git. Never commit real credentials in
`docker-compose*.yml` — use `.env` or a local override file
(`docker-compose.*local.yml`, also git-ignored) instead.

## 8. Summary checklist for operators

- [ ] Set `JWT_SECRET` explicitly in production so sessions survive
      restarts and DB resets.
- [ ] Set IGDB and (optionally) NexusMods credentials via `.env` or
      Settings → Services.
- [ ] Restrict who has login access to the app — any account holder can
      currently view all indexer/downloader credentials in plaintext via
      the API.
- [ ] Run behind HTTPS/a reverse proxy per `.github/SECURITY.md`.
- [ ] Never commit `.env`, `sqlite.db`, or `docker-compose.local.yml`.
