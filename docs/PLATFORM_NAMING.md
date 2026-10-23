# Platform Naming and Rename Patterns

Questarr places downloaded games under a platform folder inside your **Library
Root**. The **Rename Pattern** in **Settings → Import** names the game folder or,
for a single-file import, the file beneath that platform folder.

For example, with `/games` as the Library Root and `{Title} ({Year})` as the
pattern, a PC game might be imported to:

```text
/games/PC/Example Game (2024)/
```

The platform folder is chosen separately from the rename pattern. Adding
`{Platform}` to a pattern repeats that folder's name in the game name; it does
not change the platform folder itself. Importing existing games through
**Library → Library Import** does not rename or move their files.

See [Library Import](LIBRARY_IMPORT.md) for transfer modes, path mappings, and
manual review.

## Platform keys and folder names

The table below lists the platform naming catalog used by download imports.
Platform keys are internal lowercase labels, sometimes called slugs. Spaces are
intentional: `xbox series` and `wii u` are not hyphenated URL slugs. You do not
need to enter these keys in the rename pattern or rename existing directories to
match them.

The **Folder / `{Platform}`** column gives both the platform directory name and
the value inserted by the `{Platform}` token. IGDB IDs identify platforms in the
platform selection setting. This catalog is not a complete list of every
platform available from IGDB.

| Platform key    | IGDB ID | Folder / `{Platform}` |
| --------------- | ------- | --------------------- |
| `pc`            | 6       | PC                    |
| `linux`         | 3       | Linux                 |
| `mac`           | 14      | Mac                   |
| `ps1`           | 7       | PlayStation           |
| `ps2`           | 8       | PS2                   |
| `ps3`           | 9       | PS3                   |
| `ps4`           | 48      | PS4                   |
| `ps5`           | 167     | PS5                   |
| `psp`           | 38      | PSP                   |
| `psvita`        | 46      | PSVita                |
| `xbox classic`  | 11      | Xbox Classic          |
| `xbox 360`      | 12      | Xbox 360              |
| `xbox one`      | 49      | Xbox One              |
| `xbox series`   | 169     | Xbox Series           |
| `nes`           | 18      | NES                   |
| `snes`          | 19      | SNES                  |
| `n64`           | 4       | N64                   |
| `gamecube`      | 21      | GameCube              |
| `wii`           | 5       | Wii                   |
| `wii u`         | 41      | Wii U                 |
| `switch`        | 130     | Switch                |
| `gb`            | 33      | Game Boy              |
| `gbc`           | 22      | Game Boy Color        |
| `gba`           | 24      | Game Boy Advance      |
| `nds`           | 20      | Nintendo DS           |
| `3ds`           | 37      | Nintendo 3DS          |
| `master system` | 64      | Master System         |
| `mega drive`    | 29      | Mega Drive            |
| `game gear`     | 35      | Game Gear             |
| `dreamcast`     | 23      | Dreamcast             |
| `neo geo`       | 80      | Neo Geo               |
| `atari 2600`    | 59      | Atari 2600            |

## How Questarr chooses the platform

1. A recognized platform in the download's release title takes priority. For
   example, `Example.Game.PS5` selects the `PS5` folder, even if the game is also
   available on PC.
2. Without a recognized release platform, Questarr uses the first game platform
   that matches the platform selection. Stored IGDB names such as
   `PC (Microsoft Windows)` resolve to the catalog's IDs. For a game listing
   PlayStation 3 before PC, selecting only PC still chooses the `PC` folder.
3. If no selected game platform is found, folder planning uses the first game
   platform value it can resolve to an ID. If the chosen ID has no folder mapping,
   or no ID can be resolved, the folder is `PC`. It does not check later IDs just
   because the chosen ID has no folder mapping. This naming fallback does not
   bypass the automatic import filter.

Configure the filter in **Settings → Appearance → Platforms**. An empty
selection allows every platform. With a nonempty selection, a detected release
platform must be selected; otherwise, a matching game platform is required.
Unknown metadata alone does not satisfy that selection. Games whose platforms
fall outside the naming catalog may not resolve from their stored names.

## Rename-pattern tokens

Tokens use braces and are case-insensitive: `{Title}` and `{title}` are
equivalent. Literal text outside tokens is retained, subject to filename
sanitization.

| Token          | Value                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| `{Title}`      | Game title.                                                                     |
| `{TitleThe}`   | Game title with a leading "The" moved to the end, such as `Example Quest, The`. |
| `{Year}`       | Release year from the game's release date.                                      |
| `{Platform}`   | Platform folder name from the table above.                                      |
| `{Version}`    | Version parsed from the download's release title.                               |
| `{Group}`      | Release group parsed from the download's release title.                         |
| `{Source}`     | Store or DRM parsed from the release title, such as `GOG` or `Steam`.           |
| `{IgdbId}`     | The game's IGDB ID, not its platform ID.                                        |
| `{SteamAppId}` | The game's Steam App ID.                                                        |
| `{Region}`     | Reserved; currently always empty.                                               |

The default pattern is `{Title} ({Region})`. Because Region is currently empty,
this normally produces just the title.

### Examples

Assuming a game named **The Example Quest**, released in **2024**, with platform
folder **PC**, IGDB ID **12345**, and a release title containing `GOG`:

| Pattern                   | Result                      |
| ------------------------- | --------------------------- |
| `{Title}`                 | `The Example Quest`         |
| `{Title} ({Year})`        | `The Example Quest (2024)`  |
| `{TitleThe} [{Platform}]` | `Example Quest, The [PC]`   |
| `{Title} [{IgdbId}]`      | `The Example Quest [12345]` |
| `{Title} - {Source}`      | `The Example Quest - GOG`   |
| `{Title} ({Region})`      | `The Example Quest`         |

### Missing values and filename rules

- Missing metadata renders empty. Brackets containing only empty tokens and
  orphan separators at the beginning or end are removed.
- A pattern names one path segment. Slashes, `..`, unknown tokens, control
  characters, and unbalanced or nested braces are rejected.
- Filename characters such as `:`, `?`, and `*` are replaced with underscores.
  Trailing spaces and dots are removed, Windows reserved names are prefixed
  with `_`, and the name is limited to 200 UTF-8 bytes.
- When an unusable pattern or empty result reaches the naming engine, it falls
  back to the sanitized game title, or `Unknown` if the title is also unusable.

## Implementation references

- [Platform catalog and release-title detection](https://github.com/Doezer/Questarr/blob/main/shared/title-utils.ts)
- [Platform folder selection](https://github.com/Doezer/Questarr/blob/main/server/services/ImportManager.ts)
- [Naming tokens, rendering, and validation](https://github.com/Doezer/Questarr/blob/main/shared/naming.ts)
