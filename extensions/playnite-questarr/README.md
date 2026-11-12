# Questarr for Playnite

A Playnite extension that connects your couch PC to a self-hosted Questarr
server. It pushes your Playnite library up to Questarr and lets you request a
game from the couch without opening a browser.

## What it does

- **Sync library to Questarr** — sends every game in your Playnite database and
  reports which ones Questarr already tracks, which it has never heard of, and
  (optionally) promotes installed games from _wanted_ to _owned_.
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
  own.

## Requirements

- Playnite 10 or newer (script extensions run on Windows PowerShell 5.1).
- A Questarr server reachable from the Playnite machine, new enough to expose
  the `/api/integration` endpoints (play time needs `POST
/api/integration/play-sessions`, available from Questarr 1.7).

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
lowercased, punctuation flattened. Anything it cannot place comes back in the
`unmatched` list rather than being added automatically, so a sync never invents
library entries on its own. Use **Request on Questarr** for those.

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
  and is retried when the next game closes and when Playnite starts. A session
  Questarr rejects (unknown game, invalid times, a clock more than five minutes
  ahead) is dropped. A retry is never counted twice: Questarr
  ignores a session that starts at the same instant as a stored Playnite session of that game.
  Manual and timer sessions are not compared, so do not also record the same play by hand.
- It needs the **Playnite extension** access, like the library sync.

## Troubleshooting

Extension logs go to Playnite's `extensions.log`, next to `playnite.log`.

| Message                                                 | Cause                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Questarr rejected the API key (401)`                   | Key revoked, mistyped, or from another Questarr instance.                    |
| `Questarr has no integration API at this address (404)` | Wrong address, or the server predates the integration API.                   |
| `stored API key could not be decrypted`                 | `config.json` was copied from another Windows account or machine. Reconnect. |
| `Questarr is rate limiting this client (429)`           | Too many requests in a short window; retry shortly.                          |
