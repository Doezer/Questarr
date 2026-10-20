---
title: SeerrNG provider
description: Let SeerrNG request PC games from Questarr.
---

# SeerrNG provider

[SeerrNG](https://github.com/snapetech/seerrng) is a Jellyseerr-style request app. It owns users,
approvals, quotas and requester notifications. Questarr stays single tenant: it answers for the one
account that owns the API key, finds the release and imports it, and SeerrNG reads the result back.

Questarr implements the same provider contract as
[QuestarrNG](https://github.com/snapetech/QuestarrNG/blob/main/docs/contracts/seerrng-v2.openapi.yaml)
(`apiVersion` 1, `requestContractVersion` 2), so SeerrNG needs no change to talk to Questarr. SeerrNG
may still label the provider "QuestarrNG" in its own UI.

## Set up

1. In Questarr, open **Settings → Integrations → API Keys** and create a key with the access
   **Game requests (SeerrNG)**. Pick an expiry (or **Never**) and copy the key; Questarr stores only a hash.
2. In SeerrNG, add a software provider pointing to your Questarr address and paste the key.
3. Turn on **auto-search** in Questarr (Settings → Search). A request is added to the library as
   `wanted` and picked up by the normal search cycle, exactly like a game you add by hand. If
   auto-search is off, the request stays at `searching`.

A SeerrNG-only key is refused on every other route except `GET /api/integration/ping`, including
the Playnite library and request routes. Keys created before this feature (`all`) still work, and rate limiting is 300 requests per minute per key.

## What it does

- **Catalog**: search (`catalog/search`, paged `catalog/search-page`), popular games, platforms and
  game details come from the IGDB credentials already configured in Questarr. The account's content
  filters apply.
- **Requests**: `POST requests` records the SeerrNG request id in a ledger (`integration_requests`),
  adds the game as `wanted` and returns its state. Replaying the same id, title and variant returns
  the current state (200); reusing an id for something else returns 409.
- **Status**: derived on every read from the game, its downloads and its files: `searching`,
  `downloading`, `importing`, `available`, `failed`, `cancelled`. Only a cancellation is stored.
- **Retry / cancel**: retry puts a failed request back in the search pipeline. Cancel stops the
  downloads tracked for the game, marks the game `shelved` and keeps imported files.
- **Files**: `assets` lists the files registered to the game that still sit inside the library root or
  an enabled root folder, `assets/{id}` streams one (single byte range supported) and `assets/bundle`
  streams two or more as a `.tar.gz`. SeerrNG must proxy these streams; the browser never receives a
  Questarr credential or path.

## Differences from QuestarrNG

- PC only: `emulationAcquisition` is `false`.
- The operating system of the requested variant selects the game's target platform (Windows, Linux
  or Mac), so the release search requires an explicit Linux or Mac marker for those. The architecture
  is recorded but not used to filter releases.
- No "restart recovery" handshake: a request has no hidden in-flight state, so there is nothing to
  confirm after a restart. `confirmNoExistingDownload` is accepted and ignored.
- Paged catalog routes walk the first 100 IGDB results; deeper paging is not supported.
- `library/lookup` answers IGDB ids only (no Steam App ids).
- **Editions and add-ons** (contract v2.1, advertised as the `editions` capability):
  `catalog/games/{igdbId}/editions` returns the editions IGDB lists under the game (`version_parent`)
  and its expansions and DLC. An edition's `includes` are the content IGDB links to that edition; one
  with none has `contentKnown: false`, and `storyContent` is `null` unless IGDB calls the item an
  expansion (`true`) or the title is a soundtrack, bonus or cosmetic (`false`).
- **`selection` on a request**: `edition` makes Questarr acquire that edition as the game; the request
  keeps the base game's `identity` and `content.pending` lists the edition until it is acquired.
  `missing-selected` requests the base game and adds each selected add-on to the library as a wanted
  game (the same wanted state as any game; add-ons already in the library are left alone). Status,
  retry and asset delivery follow the base game; `content` reports the add-ons still missing.
  Cancelling shelves only the add-ons this request itself added and that are still wanted. An unknown
  edition or add-on id is a 400, and a selection needs the `igdbId`. Editions and add-ons hidden by the
  account's adult-content filters are neither listed nor selectable. If an add-on cannot be queued the
  request is created but ends `failed`; retry queues the missing add-ons again, and an edition request
  retries onto the edition itself.
- **Discovery** (`discover` capability): `catalog/discover` takes comma-separated IGDB ids for
  `themes`, `gameModes`, `perspectives`, `genres` and `languages` (a game matching any listed id
  qualifies) and `excludeThemes`, `excludeGameModes`, `excludeGenres` (a game with any of them is
  dropped), plus `q`, `minYear`, `maxHoursToBeat` (games without a time-to-beat estimate are left
  out) and an offset `cursor`. Results carry the usual catalog fields and the theme, mode and
  perspective names.
- Not implemented: the `wantedContent` capability. The IGDB queries behind editions and discovery follow IGDB's documented syntax but were not run against the live API.
- The handshake reports `service: "Questarr"`; SeerrNG only checks `apiVersion` and
  `requestContractVersion`.
