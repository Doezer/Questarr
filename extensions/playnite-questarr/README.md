# Questarr for Playnite

A Playnite extension that connects your couch PC to a self-hosted Questarr
server. It pushes your Playnite library up to Questarr and lets you request a
game from the couch without opening a browser.

## What it does

- **Sync library to Questarr** — one command that runs the whole pass: it
  flushes queued play sessions, reconciles which games Questarr knows, adds
  everything Questarr is missing as owned games (the first run backfills the
  whole library; later runs only pick up new games), sends completion
  statuses, and sends the GOG/Epic play time totals Playnite already holds.
  The sync runs in the background: the menu command returns immediately and
  Playnite stays responsive, a notification marks the start and another
  carries the summary when the run finishes. A lock keeps two syncs from
  overlapping — if one is already running, the new request is skipped and
  logged.
- **Request on Questarr** — right-click one or more games and add them to your
  Questarr library. Requested games land as _wanted_, which is what hands them
  to Questarr's existing auto-search: it searches your indexers on schedule and
  sends the best release to your download client.
- **Play time** — optionally sends every finished play session (its end is
  when the game closed, its start is derived from the duration Playnite reports)
  to Questarr, where it shows up in the
  game's Playtime section, its journal and the Statistics page. Off by default:
  switch it on with **Extensions → Questarr → Toggle sending play time to
  Questarr**.
- **Automatic sync** — optionally re-syncs whenever Playnite finishes updating
  its library, so installing a game on the couch PC shows up in Questarr on its
  own. It is the same background push as the menu command, with the same
  overlap guard.
- **Titles IGDB cannot match** — a sync only adds games Questarr can match on
  IGDB; anything else comes back unmatched. Those titles are cached in
  `import-skip.json` next to `config.json`, so later syncs never pay the IGDB
  lookup cost for them again. Delete that file to force a retry.

Playnite offers script extensions no live progress bar (its progress dialog
route does not invoke script delegates on current builds), so the extension's
feedback is the two notifications plus the detail in `extensions.log`.

## Requirements

- Playnite 10 or newer (script extensions run on Windows PowerShell 5.1).
- A Questarr server reachable from the Playnite machine, new enough to expose
  the `/api/integration` endpoints. The unified sync needs `POST
/api/integration/library/sync`, `POST /api/integration/library/import` and
  `POST /api/integration/play-status`; play time needs `POST
/api/integration/play-sessions`, available from Questarr 1.7.

## Install

1. Copy the `playnite-questarr` folder into your Playnite extensions directory:
   `%APPDATA%\Playnite\Extensions\` (or `Extensions\` next to `Playnite.exe`
   for a portable install).
2. Restart Playnite. Playnite loads unsigned script extensions but will ask you
   to confirm the first time.

## Connect

1. In Questarr, open **Settings → Integrations → API Keys** and create a key
   (name it after the machine, e.g. "Playnite on the living room PC", and choose
   the **Playnite extension** access). Copy it
   immediately — Questarr stores only a hash and cannot show it again.
2. In Playnite, open **Extensions → Questarr → Connect to Questarr…**
3. Enter the server address (`https://questarr.example.com`, or whatever your
   reverse proxy serves) and paste the key. A plain `http://` address is also
   accepted — for a local address (a loopback, `192.168.x.x`/`10.x.x.x` IP, or
   a `.local` hostname) or any other address — but always shows a warning
   first and asks for confirmation, since the key travels in cleartext over
   `http://` either way. Use `https://` whenever you can; the warning is
   stronger for an address outside your own network, where that cleartext
   traffic can cross the open internet.

The extension pings the server before saving, so a bad address or key fails
right there instead of silently at the next sync. A same-host redirect (a
reverse proxy enforcing `https://`, or normalizing a trailing slash) is
followed automatically with the key intact; a redirect to any other host, or
a same-host redirect from `https://` down to `http://`, is refused instead,
since either would otherwise move the key somewhere it never had consent to
go.

## Where settings are stored

Configuration lives in Playnite's extension data directory as `config.json`.
The API key is encrypted with Windows DPAPI against the user account that
entered it, so the file is useless if copied to another machine or account. It
is _not_ protection against code already running as that same user — treat the
key as a credential and revoke it in Questarr if the machine is compromised.

## What the key can do

An integration API key is accepted **only** on Questarr's `/api/integration`
routes. It cannot read your settings, manage indexers or download clients, or
create or revoke other API keys — those stay behind an interactive login. Revoke
a key at any time from **Settings → Integrations → API Keys**; it stops working
immediately.

Keys have an **access** level (the extension needs **Playnite extension**; a
**Read only** key can ping and read the library but not sync or request games) and
an optional **expiry**. Once a key expires Questarr answers 401 with
`code: "API_KEY_EXPIRED"`: create a new key and reconnect. Choose **Never** when
creating the key if you prefer not to rotate it. `/api/integration/ping` returns the
key's `scope` and `expiresAt`.

## How matching works

Questarr matches an incoming Playnite entry by Steam App ID first (for games
from Playnite's Steam library), then by a normalized title comparison —
lowercased, punctuation flattened. A sync first asks Questarr which games it
knows; only the ones it does not are sent for import, where IGDB does the
matching. A title IGDB matches to a different game (a sequel, another
subtitle) is skipped rather than added wrongly; "Game of the Year
Edition"-style suffixes are accepted. Use **Request on Questarr** for the rest.

## Play time

With play time enabled, closing a game sends one session to Questarr: the game,
when it started and when it ended. Playnite measures the duration itself, so no
timer has to be started by hand.

- The game is matched like in a library sync: Steam App ID first, then the
  normalized title. A game Questarr does not know is skipped (a line in
  `extensions.log`), never created.
- Launches shorter than a minute are ignored, and so is anything longer than 24
  hours (a game left open overnight), as Questarr does not accept such a
  session.
- If a session cannot be sent for a retryable reason (Questarr unreachable, rate
  limited, a server error or a key problem), it waits in `play-sessions-queue.json`
  next to `config.json` (at most 200 entries, the oldest is dropped beyond that)
  and is retried when the next game closes, when Playnite starts, and at the
  front of every sync. A session
  Questarr rejects (unknown game, invalid times, a clock more than five minutes
  ahead) is dropped. A retry is never counted twice: Questarr
  ignores a session that starts at the same instant as a stored Playnite session of that game.
  Manual and timer sessions are not compared, so do not also record the same play by hand.
- It needs the **Playnite extension** access, like the library sync.

## Play status

Each game's Playnite completion status is mapped onto Questarr's: _Not Played_,
_Plan to Play_ and _Played_ become **owned**, _Playing_ becomes **playing**,
_On Hold_ and _Abandoned_ become **shelved**, _Beaten_ and _Completed_ become
**completed**. A custom status Questarr does not know is skipped. The game's
store (Steam, GOG or Epic) is sent along and recorded as where the status came from.

- Statuses ride along with every sync; with the automatic option on they are
  sent after each library update, entirely in the background.
- A game is matched like in a library sync (Steam App ID, then normalized
  title) and is never created.
- A status you set yourself in Questarr (playing, shelved or completed) is never
  overwritten; only a status that an earlier sync wrote can be replaced. Games
  Questarr is still downloading are left alone too.
- Games with no completion status in Playnite are not sent.
- It needs the **Playnite extension** access, like the library sync.

## GOG and Epic library and play time

Steam games need no extension command: Questarr reads their total itself (Settings → Steam → Steam play time → Preview import).

Playnite's own GOG and Epic plugins read the libraries; the extension never talks to GOG or Epic. Epic has no public library API and the extension does not scrape the store, so Playnite's Epic plugin is the only source.

- Every sync adds the GOG and Epic games Questarr does not have as **owned**
  games, matched on IGDB, and sends the total play time Playnite has for each
  of them with at least ten minutes of it. Questarr subtracts the time it
  already recorded and adds the rest as one estimated session ending at the
  game's last activity, so running a sync again changes nothing. A game with a
  timer running is skipped.
- The play time sent is whatever total Playnite holds for each game; a game with none recorded there is left out. The games are recorded with source `epic` (GOG ones with `gog`).
- It needs Questarr 1.7 and the **Playnite extension** access.

## Troubleshooting

Extension logs go to Playnite's `extensions.log`, next to `playnite.log`.

| Message                                                 | Cause                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Questarr rejected the API key (401)`                   | Key revoked, mistyped, or from another Questarr instance.                    |
| `Questarr has no integration API at this address (404)` | Wrong address, or the server predates the integration API.                   |
| `stored API key could not be decrypted`                 | `config.json` was copied from another Windows account or machine. Reconnect. |
| `Questarr is rate limiting this client (429)`           | Too many requests in a short window; retry shortly.                          |
| `a background sync is already running` (log only)      | A sync is in flight; the new request was skipped, nothing was lost.          |
