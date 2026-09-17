# Home server app store integrations

Questarr ships ready-made app definitions for the main self-hosting platforms, so it can be
installed without hand-writing a Compose file. Every definition points at the same published image
(`ghcr.io/doezer/questarr:latest`, `linux/amd64` + `linux/arm64`) and uses the same two mounts:

| Container path | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `/app/data`    | Questarr data, including the SQLite database. Required, must be persisted.      |
| `/data`        | Optional. The same root your download client writes into, used to import games. |

If you mount `/data`, add a matching entry under **Settings → Path Mappings** with **Local Path**
`/data` and **Remote Path** set to the exact path your download client reports for that root.
Leave it unmounted if you import manually.

| File                                       | Platform                        |
| ------------------------------------------ | ------------------------------- |
| `casaos/docker-compose.yml`                | CasaOS (AppFile)                |
| `umbrel-app-store.yml`, `doezer-questarr/` | Umbrel (community app store)    |
| `cosmos/questarr.cosmos-compose.json`      | Cosmos Cloud (ServApp)          |
| `unraid/questarr.xml`                      | Unraid (Community Applications) |
| `questarr/config.yaml`                     | Home Assistant add-on           |

## CasaOS

CasaOS installs custom apps from an AppFile — a Compose file carrying `x-casaos` metadata.

1. Open the **App Store** and click **Custom Install**.
2. Click the **import** icon (top right) and paste:
   `https://raw.githubusercontent.com/Doezer/Questarr/main/casaos/docker-compose.yml`
3. Adjust the mounts if needed. The defaults are `/DATA/AppData/questarr` → `/app/data` and
   `/DATA/Downloads` → `/data`.
4. Click **Install**, then open Questarr from the CasaOS dashboard (port `5000`).

The AppFile declares both architectures, the health check, and `PUID`/`PGID`/`UMASK` so files
written into your shares stay owned by the right user.

## Umbrel

Umbrel installs third-party apps from a _community app store_ — a Git repository with a root-level
`umbrel-app-store.yml` and one top-level directory per app, named after that app's ID. This
repository's root `umbrel-app-store.yml` (store ID `doezer`) and `doezer-questarr/` directory are
exactly that; Umbrel requires app IDs to be prefixed with the store ID, hence `doezer-questarr`
rather than `questarr` (which is already used by the
[Home Assistant add-on](../README.md#home-assistant-add-on) directory).

1. In umbrelOS, open the **App Store**.
2. Click the **⋮** menu (top right) → **Community App Stores**.
3. Add `https://github.com/Doezer/Questarr` and open the **Doezer** store.
4. Install **Questarr** (`doezer-questarr`). Umbrel routes it through its own `app_proxy`, so it
   appears on your dashboard and is reachable at `http://umbrel.local:5000`.

App data lives in `${APP_DATA_DIR}/data`. The optional library mount defaults to
`${UMBREL_ROOT}/data/storage/downloads`; edit `doezer-questarr/docker-compose.yml` (or the installed
copy) if your download client writes elsewhere.

## Cosmos Cloud

Cosmos installs apps as _ServApps_ from a `cosmos-compose.json`.

1. Open **Market Place → Custom Install** (or **Servapps → Add**).
2. Paste:
   `https://raw.githubusercontent.com/Doezer/Questarr/main/cosmos/questarr.cosmos-compose.json`
3. Fill in the install form: **Data folder**, optional **Library folder**, and `PUID`/`PGID`.
4. Install. Cosmos creates a route at `questarr.<your-server-hostname>` with SmartShield and bot
   blocking enabled, and handles HTTPS for you.

To browse Questarr from the Cosmos market list instead, add
`https://raw.githubusercontent.com/Doezer/Questarr/main/cosmos/index.json` as a custom market source.

## Keeping definitions in sync

The app definitions duplicate settings that also live in `docker-compose.yml` and
`unraid/questarr.xml`. When you change the exposed port, the data path, or the health check, update
all of them together.
