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
- **Automatic sync** — optionally re-syncs whenever Playnite finishes updating
  its library, so installing a game on the couch PC shows up in Questarr on its
  own.

## Requirements

- Playnite 10 or newer (script extensions run on Windows PowerShell 5.1).
- A Questarr server reachable from the Playnite machine, new enough to expose
  the `/api/integration` endpoints.

## Install

1. Copy the `playnite-questarr` folder into your Playnite extensions directory:
   `%APPDATA%\Playnite\Extensions\` (or `Extensions\` next to `Playnite.exe`
   for a portable install).
2. Restart Playnite. Playnite loads unsigned script extensions but will ask you
   to confirm the first time.

## Connect

1. In Questarr, open **Settings → Integrations → API Keys** and create a key
   (name it after the machine, e.g. "Playnite on the living room PC"). Copy it
   immediately — Questarr stores only a hash and cannot show it again.
2. In Playnite, open **Extensions → Questarr → Connect to Questarr…**
3. Enter the server address (`http://questarr.local:5000`, or whatever your
   reverse proxy serves) and paste the key.

The extension pings the server before saving, so a bad address or key fails
right there instead of silently at the next sync.

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

## How matching works

Questarr matches an incoming Playnite entry by Steam App ID first (for games
from Playnite's Steam library), then by a normalized title comparison —
lowercased, punctuation flattened. Anything it cannot place comes back in the
`unmatched` list rather than being added automatically, so a sync never invents
library entries on its own. Use **Request on Questarr** for those.

## Troubleshooting

Extension logs go to Playnite's `extensions.log`, next to `playnite.log`.

| Message                                                 | Cause                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Questarr rejected the API key (401)`                   | Key revoked, mistyped, or from another Questarr instance.                    |
| `Questarr has no integration API at this address (404)` | Wrong address, or the server predates the integration API.                   |
| `stored API key could not be decrypted`                 | `config.json` was copied from another Windows account or machine. Reconnect. |
| `Questarr is rate limiting this client (429)`           | Too many requests in a short window; retry shortly.                          |
