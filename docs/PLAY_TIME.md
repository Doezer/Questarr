# Play time

Track how long you spend in each game. Sessions are personal: they stay on your Questarr server and
are never sent anywhere.

## Start a timer

- On the **Playing** page (and anywhere a game with status **Playing** is listed), each game has a
  **Start timer** button. Press it when you sit down to play and **Stop** when you are done; the
  button shows the running time.
- You can run **one timer at a time**. While one runs, the other games' buttons are disabled.
- A timer left running is cut off at 24 hours when you stop it, so a forgotten timer does not
  inflate your totals. Questarr tells you when that happens.

## Add time by hand

Open a game's page and scroll to **Playtime**. Pick the day, enter the hours and minutes, and press
**Add session**. For today, the session ends now; for an earlier day it is recorded at noon that
day. A session can be up to 24 hours and cannot end in the future. **Delete** removes a session.

The Playtime section also shows the game's total and how it compares with the IGDB
[Time to Beat](https://www.igdb.com/) estimate when there is one.

## Statistics

The **Statistics** page has a **Play time** section with:

- the total time played, the number of sessions and the longest session
- your current and best **play streak** (consecutive days with play; today or yesterday keeps a
  streak alive)
- hours per **week** (last 12) or **month** (last 12)
- your **most played** games, each against its IGDB estimate
- time by **genre** and **platform**

Days, weeks (starting Monday) and months follow your browser's time zone (its IANA name, such as
`Europe/Paris`, so daylight saving time is applied to each session on its own date). A session counts
on the day it started. A timer that is still running is not counted until you stop it.

## Playnite

The [Playnite extension](../extensions/playnite-questarr/README.md) can send each finished session
(`POST /api/integration/play-sessions`, source `playnite`). It is off
by default and needs the **Playnite extension** API key access. A session that starts at the same
instant as a stored `playnite` session for that game is ignored, so a retry never counts twice (a
manual or timer session is not compared: do not also record the same play by hand). The end is the
moment the game closed and the start is derived from the duration Playnite reports (whole seconds),
so these times are estimates and a session near midnight can land on the neighbouring day.

## Steam play time

**Settings → Steam → Steam play time** records the time you play on Steam. Steam only reports a
running total per game (`playtime_forever`), so Questarr remembers the last total it saw and, on each
sync, adds the growth as **one session** that ends at the sync (source `steam`, shown as "Steam ·
estimated"). It needs a saved Steam ID, `STEAM_API_KEY` on the server and public Steam "Game details".

- It is **off by default**. Turning it on starts from your current totals: the first sync only notes
  them, and a game added to your library later is noted the same way, so no history is invented.
  Turning it off and on again starts over.
- It runs every 6 hours (**Activity → System Tasks → Steam play-time sync**) and with **Sync now**; two
  runs less than 30 minutes apart are merged unless you press **Sync now**.
- **No double counting**: the minutes of timer, manual and Playnite sessions recorded for that game since
  the previous sync are subtracted from the growth. A game with a running timer waits for the next sync.
- A total that Steam lowers is followed without creating a session.
- Estimated sessions count in the totals, the weekly and monthly charts and the per-game and per-genre
  figures, but **not** in the longest session or the streaks, because they say nothing about when or how
  long one sitting lasted. A long gap between syncs shows up as one long session on the day it started.
- Other launchers (GOG, Epic, EA app, Ubisoft Connect) are not read directly. Play them through Playnite
  to get sessions from its extension.

## What is stored

Each session records the game, when it started, when it ended (empty while the timer runs) and its
source: `timer`, `manual`, `playnite` or `steam` (estimated, see above). The Steam sync keeps its
last totals per game in a small per-user document in the system configuration, so it needs no table. Sessions are deleted with their game. They are included when you move from SQLite to
Postgres (`scripts/sqlite-to-pg.ts`).

Not included yet: importing historical playtime from Steam (the first sync only notes your totals) or Playnite (the extension only reports new sessions), and per-game goals. See
[Questarr-mgmt#71](https://github.com/Doezer/Questarr-mgmt/issues/71).
