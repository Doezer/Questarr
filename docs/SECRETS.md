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
against a Zod schema in `server/config.ts:10-59`. If any variable fails
validation, the server logs the error and exits (`server/config.ts:64-80`)
rather than starting with an invalid configuration.

| Variable                                | Purpose                                                       | Required?                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                            | Signs/verifies session JWTs                                   | No — auto-generated and persisted to the DB if unset (§2)                                                                                                                                                                     |
| `NEXUSMODS_API_KEY`                     | NexusMods mod lookups                                         | No — validated by `envSchema`; can be set later in Settings → Services (§3)                                                                                                                                                   |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch/IGDB OAuth for game metadata & discovery               | No env-wise, but one of env/DB must be set for discovery to work                                                                                                                                                              |
| `PORT`                                  | HTTP port                                                     | No (default `5000`)                                                                                                                                                                                                           |
| `HOST`                                  | Bind address                                                  | No — **defaults to `0.0.0.0` (all interfaces) in every deployment mode**, not just Docker (`server/config.ts:52`). Set `HOST=127.0.0.1` explicitly if you don't want the server reachable from other machines on the network. |
| `NODE_ENV`                              | `development` \| `production` \| `test`                       | No (defaults to `production`)                                                                                                                                                                                                 |
| `SQLITE_DB_PATH`                        | Path to the SQLite database file                              | No (default `sqlite.db`)                                                                                                                                                                                                      |
| `CREDENTIALS_ENCRYPTION_KEY`            | AES-256 key encrypting indexer/downloader credentials at rest | No — auto-generated (32 random bytes) and persisted to the DB if unset; must be a 64-char hex string if provided (§4)                                                                                                         |

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
| **NexusMods**                                    | `.env` (`NEXUSMODS_API_KEY`) or Settings → Services                   | DB `system_config` key `nexusmods.apiKey`; client reconfigured in-memory on save (`server/nexusmods.ts:46-69,176-182`)              | Manual — overwrite the key in Settings.                                                                                                                                                                                  |
| **HowLongToBeat**, **PCGamingWiki**, **xREL.to** | N/A                                                                   | N/A                                                                                                                                 | These are unauthenticated public APIs; no credentials involved.                                                                                                                                                          |
| **Steam** wishlist import                        | N/A (public Steam endpoints + user's `steamId64`)                     | N/A                                                                                                                                 | N/A                                                                                                                                                                                                                      |
| **Discord** notification webhook                 | Settings → Services                                                   | DB `system_config` key `discord.webhookUrl`, plaintext (`server/routes.ts:2769-2801`)                                               | Manual — overwrite the URL in Settings.                                                                                                                                                                                  |

All four of these settings endpoints follow the same pattern: `GET`
never returns the real secret, and updating it without changing the
non-secret part (if any) is done by sending the sentinel string
`"********"` for the unchanged field. `GET /api/settings/igdb` returns
the `clientId` but never the `clientSecret` (`server/routes.ts:2709-2768`
sends/accepts the sentinel). `GET /api/settings/nexusmods` returns only
`{ configured, source }` booleans (`server/routes.ts:3311-3342`).
`GET /api/settings/discord` returns `{ configured, webhookUrl: "********" }`
when set, and `POST` treats the sentinel as "no change"
(`server/routes.ts:2769-2801`). All four handlers sit behind
`sensitiveEndpointLimiter`.

## 4. User-entered indexer & downloader credentials

This is the largest surface of stored secrets: Torznab/Newznab indexer API
keys, and usernames/passwords for download clients (qBittorrent,
Transmission, rTorrent, sabnzbd, nzbget).

- **Storage:** encrypted at rest. `indexers.apiKey` and
  `downloaders.username` / `downloaders.password` are AES-256-GCM encrypted
  before being written to SQLite and decrypted on read
  (`server/credential-crypto.ts`, wired into `server/storage.ts`'s
  `addIndexer`/`updateIndexer`/`getIndexer`/`getAllIndexers`/`getEnabledIndexers`/
  `syncIndexers` and the equivalent downloader methods). Each encrypted value
  is prefixed `enc:v1:` and stores a random 12-byte IV + auth tag + ciphertext,
  base64-encoded — so two encryptions of the same plaintext never look alike
  at rest. Rows written before this feature existed are legacy plaintext;
  `decryptCredential()` detects the missing prefix and returns them unchanged
  (no migration required), and they get encrypted the next time they're
  saved.
  - **Encryption key:** resolved the same way as `JWT_SECRET` (§2) —
    `CREDENTIALS_ENCRYPTION_KEY` env var, then the DB `system_config` key
    `credentials_encryption_key`, then auto-generated (32 random bytes) and
    persisted (`server/credential-crypto.ts:getCredentialsEncryptionKey`).
    Losing this key (e.g. wiping `system_config` without also setting the
    env var) makes previously encrypted rows undecryptable.
- **In transit to the indexer/download client:** the storage layer decrypts
  transparently, so `server/downloaders/*.ts` and `server/search.ts` receive
  plaintext exactly as before — HTTP Basic Auth (base64, not encryption) for
  qBittorrent/Transmission-style clients, and RFC 2617 Digest Auth
  challenge-response for rTorrent (`server/downloaders/rtorrent.ts:596-621`).
  - **MD5 fallback (accepted risk):** RFC 2617's classic Digest Auth only
    defines MD5; `rtorrent.ts:596,599` uses SHA-256 whenever the rTorrent/
    ruTorrent server's challenge advertises `algorithm=SHA-256`, and falls
    back to MD5 only for servers that don't (the common case, since most
    rTorrent/ruTorrent builds still only implement the original RFC 2617
    MD5 scheme). This is an interoperability requirement, not a choice —
    there is no more-secure alternative that the target servers accept.
    Risk is limited: the digest response is an HMAC-style construction
    keyed by server-issued `nonce`/client `cnonce` per request
    (`rtorrent.ts:608-621`), not a bare hash of the credential, so MD5's
    known collision weakness doesn't directly expose the password —
    the exposure is the same one every RFC 2617 MD5 deployment has always
    carried. Mitigation: always prefer a downloader/network path that
    terminates in TLS between Questarr and the rTorrent host where
    possible, since Digest Auth (either hash) still doesn't encrypt the
    request/response bodies themselves. No other code path in Questarr
    depends on MD5.
- **Access control / API exposure:** every indexer/downloader route sits
  behind the global `authenticateToken` middleware (`server/routes.ts:821-829`).
  `GET /api/indexers`, `GET /api/indexers/:id`, `GET /api/downloaders`, and
  `GET /api/downloaders/:id` mask the secret field before responding —
  `apiKey` / `password` come back as `"********"` whenever a real value is
  set (`maskIndexer`/`maskDownloader` helpers, `server/routes.ts`). The same
  masking applies to the `POST`/`PATCH` responses. `username` is not treated
  as a secret and is still returned in full, matching how it's used (a login
  name, not a token).
- **Rotation:** `PATCH /api/indexers/:id` / `PATCH /api/downloaders/:id`
  follow the IGDB masked-sentinel convention — sending `"********"` for
  `apiKey`/`password` leaves the stored value unchanged (the sentinel is
  stripped from the update before it reaches storage); sending any other
  value overwrites and re-encrypts it. This is what lets the edit dialogs
  prefill the field with the mask without silently clobbering the real
  secret on save.

## 5. User account passwords

`users.passwordHash` (`shared/schema.ts:6-11`) never stores plaintext.
Hashing uses `bcryptjs` with `SALT_ROUNDS = 10` (`server/auth.ts:1,10,69-75`).
Passwords are hashed on signup (`server/routes.ts:309`), verified on login
(`server/routes.ts:369-371`), and the password-change endpoint requires the
current password before accepting a new one
(`server/routes.ts:392-419`).

## 6. Rate limiting around credentials (`server/middleware.ts`)

| Limiter                    | Limit                     | Applied to                                                                                               |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `authRateLimiter`          | 20 requests / 15 min / IP | `POST /api/auth/login`                                                                                   |
| `sensitiveEndpointLimiter` | 30 requests / min / IP    | Indexer/downloader writes, password change, IGDB/NexusMods/Discord settings, SSL settings, Prowlarr sync |
| `generalApiLimiter`        | 100 requests / min / IP   | General fallback                                                                                         |

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
- [ ] Set `CREDENTIALS_ENCRYPTION_KEY` explicitly in production so stored
      indexer/downloader credentials stay decryptable across DB resets
      (`openssl rand -hex 32`).
- [ ] Set IGDB and (optionally) NexusMods credentials via `.env` or
      Settings → Services.
- [ ] Restrict who has login access to the app — Questarr has no per-user
      role scoping, so any account holder can use every configured
      indexer/downloader (though the API keys/passwords themselves are
      masked in responses and encrypted at rest, per §4).
- [ ] Run behind HTTPS/a reverse proxy per `.github/SECURITY.md`.
- [ ] Never commit `.env`, `sqlite.db`, or `docker-compose.local.yml`.
