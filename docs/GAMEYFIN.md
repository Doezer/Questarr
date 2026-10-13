---
title: Gameyfin
description: Show the games Questarr imports in a Gameyfin library.
---

# Gameyfin

[Gameyfin](https://github.com/gameyfin/gameyfin) is a web library for a PC game collection: it scans
folders, fetches metadata and lets people download games from a browser. It has no acquisition, so the
two apps complement each other: Questarr finds and imports games, Gameyfin presents them.

Questarr needs no integration code for this. The two share a folder and Gameyfin does the rest.

## Share the library folder

Questarr imports a game to `<library root>/<platform folder>/<game folder>` (for PC games the platform
folder is `PC`; see [Library Import](LIBRARY_IMPORT.md)). Gameyfin treats every folder directly inside a
library directory as one game.

1. Make the folder visible to both containers (same host path, mounted read-write for Questarr and
   read-only is enough for Gameyfin).
2. In Gameyfin, create a library and add the Questarr platform folder (for example `/data/PC`) as one of
   its directories.
3. In Gameyfin, turn on **Enable automatic library scanning using file system watchers** (off by
   default). When Questarr finishes an import, Gameyfin notices the new folder and scans that library.
   Without the watcher, trigger a scan from Gameyfin or rely on its scheduled scan.
4. In Questarr, keep **Sort add-on files into subfolders** and **Rename Pattern** as you like: Gameyfin
   reads the game name from the folder name, so a pattern such as `{Title}` or `{Title} ({Year})`
   matches best.

## What is not possible today

Gameyfin has no API key or token. Everything beyond folder scanning goes through its web interface
endpoints, which need an administrator session and a CSRF token, and `triggerScan` is admin only. Questarr
would have to store a Gameyfin administrator password and replay a browser login, which it deliberately
does not do. For that reason these ideas are not implemented:

- Triggering a Gameyfin scan from Questarr (the file system watcher covers this).
- Pulling Gameyfin game requests into Questarr's wanted list, and reporting their status back.
- Marking games owned in Questarr from the Gameyfin catalog.

Requests from a request app are covered by the [SeerrNG provider](SEERRNG.md) instead. If Gameyfin adds
scoped API tokens, the scan trigger and the ownership sync become small additions.
