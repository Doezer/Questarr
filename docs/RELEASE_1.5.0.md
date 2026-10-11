# Preparing Questarr 1.5.0

The comparison baseline is `v1.5.0-rc1`. The [changelog](CHANGELOG.md) describes
the whole release; this checklist covers additions and fixes after RC1.
Tag creation and deployment are separate maintainer actions. Keep the changelog
marked Unreleased until the release date is known.

## Automated verification

Use the Node version from CI and `npm ci`, then install Chromium with
`npx playwright install --with-deps chromium`. In one terminal start
`npm run dev:test`; this resets `data/test.db`, disables rate limits, and serves
Questarr on port 5100. Use an isolated checkout/data directory: these commands
are for a disposable test instance.

In another terminal run:

```sh
npm run test:e2e -- --workers=1
npm run check
npm run lint
npm run format:check
npm run test:run
npm run build
```

Run the full browser suite, not just the new file: earlier release journeys
cover Playing, DLC, platform/content filters, blacklisting, API integrations,
download dialogs, authentication, and navigation. One worker avoids concurrent
journeys changing shared account settings. Browser journeys simulate external
services where indicated below; they do not verify a live provider's credentials.

| Change since RC1                                                                              | Browser coverage                                                                                       | Backend/behavior coverage                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Library Import navigation, automatic add/enable scans                                         | `tests/e2e/post-rc1.spec.ts` (real temporary folder and API), `release-features.spec.ts` (manual scan) | `server/__tests__/api_routes.test.ts`, `library-scanner.test.ts`                                 |
| IGDB name search and match confirmation, failed-search retry                                  | `post-rc1.spec.ts` (simulated IGDB/review responses)                                                   | `api_routes.test.ts`, `library-scanner.test.ts`, `client/__tests__/RootFolderDiscovery.test.tsx` |
| Scan batching, deferred rescans, progress and Library/Discover refresh                        | Library Import journeys                                                                                | `library-scanner.test.ts`, `api_routes.test.ts`, `client/__tests__/RootFolderDiscovery.test.tsx` |
| Backlog roulette, filtered pools, reroll, details and persisted Playing status                | `tests/e2e/backlog-roulette.spec.ts`                                                                   | `client/__tests__/BacklogRoulette.test.tsx`                                                      |
| Saved Prowlarr defaults, priority validation, HTTP opt-in/revocation and URL-bound masked key | `post-rc1.spec.ts` (simulated Prowlarr responses)                                                      | `server/__tests__/prowlarr.test.ts`, `prowlarr-settings.test.ts`, `api_routes.test.ts`           |
| Apprise API login, HTTP warning and masked password through mode switches                     | `post-rc1.spec.ts` (simulated settings responses)                                                      | `server/__tests__/apprise.test.ts`, `api_routes.test.ts`                                         |
| Shelved/Completed update and pack notification controls                                       | `post-rc1.spec.ts` (real settings persistence)                                                         | `server/__tests__/cron_autosearch.test.ts` (muting preserves availability flags)                 |
| Scheduled RSS refresh, overlapping refresh serialization                                      | RSS refresh journey in `post-rc1.spec.ts` (simulated feed responses)                                   | `server/__tests__/cron_rss.test.ts`, `rss.test.ts` (fake timer and queue tests)                  |
| Calendar year-view past months/releases and local-day datetime handling                       | Calendar journey in `post-rc1.spec.ts`                                                                 | `client/__tests__/CalendarPage.test.tsx`                                                         |
| Numbered/Roman sequel rejection without dropping valid versions/updates                       | Existing search/download journeys                                                                      | `shared/__tests__/title_utils.test.ts`                                                           |
| Newznab category separators, SABnzbd configured category fallback                             | Real-client journey in `tests/stack/real-stack.spec.ts`                                                | `server/__tests__/newznab_search_request.test.ts`, `downloaders_sabnzbd_remaining.test.ts`       |
| Per-user Socket.IO notification isolation                                                     | `tests/e2e/realtime.spec.ts`                                                                           | `server/__tests__/socket-user-scoping.test.ts` (two users)                                       |
| Archive expansion limits and split-volume/link parsing                                        | Existing import journeys                                                                               | `server/__tests__/archive_service.test.ts`, `import_routes_coverage.test.ts`                     |
| IPv6 scan rate limiting                                                                       | Existing authentication journeys                                                                       | `server/__tests__/scan-ratelimit.test.ts`                                                        |

`npm run test:stack` additionally exercises the production build against real
qBittorrent, Transmission and SABnzbd daemons and a local test indexer. Install
and configure its prerequisites as in `.github/workflows/stack.yml`; build first.
The SABnzbd journey checks the configured category in the actual queue.

## Upgrade and operator checks

1. Back up the database and persistent configuration, including encryption keys.
   Retain the `data` volume when replacing the container. For PostgreSQL, follow
   [DATABASE.md](DATABASE.md); setting `DATABASE_URL` alone does not change dialect.
2. Check that extra game directories are mounted and readable, then verify
   [Library Import](LIBRARY_IMPORT.md) can scan and review a folder. File deletion
   stays opt-in for each discovery root.
3. Reopen the Prowlarr sync dialog: saved values should be masked/prefilled.
   HTTP requires the explicit insecure-LAN choice; use it only on a trusted LAN.
   Test a synced indexer and verify its priority and categories.
4. If using authenticated Apprise API, enter its optional username/password in
   Settings → Notifications and send a test notification. Use HTTPS for a public
   server. Review notification controls for Shelved and Completed games.
5. Verify enabled RSS feeds acquire a new last-check time after startup and the
   hourly schedule. Manual **Refresh Feeds** remains available.
6. Check a representative archive import against the configured `ARCHIVE_*`
   limits; oversized or unsafe archives should require intervention rather than
   importing partially. See [SECRETS.md](SECRETS.md).
7. For path-prefix deployments, verify navigation and Socket.IO behind the
   proxy using [REVERSE_PROXY.md](REVERSE_PROXY.md). Check Windows, Helm, and
   other packaging metadata in their own release workflows before publishing.
   The Helm app version and Home Assistant add-on version are `1.5.0` (chart
   `0.1.2`). Ensure the published image tag matches the chart's app version, or
   override `image.tag` with the exact tag you publish, such as `v1.5.0`.

Documentation reviewed for this release includes the root and packaged READMEs,
deployment, database/migration, API, architecture, security, dependency and
operator guides. The dated PRD/roadmap describes planning history; it is not the
release feature inventory. Use the changelog for shipped behavior.
