# Proxmox VE — LXC deployment

Questarr can run directly inside a Proxmox VE LXC container, without Docker. The container runs
Questarr from source as a `systemd` service, which keeps the footprint small (no container runtime,
no image layers) and makes it behave like any other service on your Proxmox node.

## Quick start

Run this **on the Proxmox host** (the node itself, not inside a container or VM), as `root`:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-lxc.sh)"
```

The script will:

1. Verify it is running on a Proxmox VE node.
2. Prompt for the container settings (ID, hostname, cores, RAM, disk, storage, network, port), each
   with a sensible default.
3. Download the newest Debian LXC template if your node does not already have it.
4. Create and start an unprivileged container.
5. Install Node.js, build Questarr from source, and register a `questarr.service` unit.
6. Print the URL to open.

When it finishes, open `http://<container-ip>:5000`.

## Non-interactive install

Every prompt has an environment variable override. Pass `--yes` to accept all of them without
prompting:

```bash
CTID=210 CT_HOSTNAME=questarr CORES=2 RAM=2048 DISK=8 \
STORAGE=local-lvm BRIDGE=vmbr0 NET=dhcp \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-lxc.sh)" -- --yes
```

| Variable           | Default           | Description                                        |
| ------------------ | ----------------- | -------------------------------------------------- |
| `CTID`             | next free ID      | Container ID                                       |
| `CT_HOSTNAME`      | `questarr`        | Container hostname                                 |
| `CORES`            | `2`               | CPU cores                                          |
| `RAM`              | `2048`            | RAM in MiB                                         |
| `SWAP`             | `512`             | Swap in MiB                                        |
| `DISK`             | `8`               | Root disk in GiB                                   |
| `STORAGE`          | first active      | Storage for the root filesystem                    |
| `TEMPLATE_STORAGE` | first active      | Storage holding the LXC template                   |
| `BRIDGE`           | `vmbr0`           | Network bridge                                     |
| `NET`              | `dhcp`            | `dhcp`, or a static CIDR such as `192.168.1.50/24` |
| `GATEWAY`          | —                 | Gateway, required when `NET` is a static address   |
| `UNPRIVILEGED`     | `1`               | Create an unprivileged container                   |
| `ONBOOT`           | `1`               | Start the container when the node boots            |
| `CT_PASSWORD`      | —                 | Root password inside the container (optional)      |
| `QUESTARR_PORT`    | `5000`            | HTTP port Questarr listens on                      |
| `QUESTARR_REPO`    | `Doezer/Questarr` | Source repository                                  |
| `QUESTARR_REF`     | latest release    | Tag or branch to install                           |

### Sizing

2 GiB of RAM is the practical floor: the installer builds the client with Vite and type-checks the
server with `tsc`, and both run during installation. You can lower the container's RAM afterwards if
you want — Questarr itself is comfortable in far less — but leave it at 2 GiB whenever you update,
since an update rebuilds from source.

The default 8 GiB disk covers the OS, Node.js, `node_modules`, and the build output with room to
spare. Questarr's own data (a SQLite database) stays small; it does not store game files.

## Managing the container

```bash
pct enter 210                          # shell inside the container
pct exec 210 -- systemctl status questarr
pct exec 210 -- journalctl -u questarr -f
pct exec 210 -- systemctl restart questarr
```

Inside the container:

| Path                              | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `/opt/questarr`                   | Application (replaced on every update)         |
| `/opt/questarr/data`              | SQLite database — **this is what you back up** |
| `/opt/questarr/.env`              | Configuration, preserved across updates        |
| `/opt/questarr/.questarr_version` | Installed tag or branch                        |

## Updating

Following the Proxmox helper-script convention, the installer places an `update` command inside the
container:

```bash
pct exec 210 -- update
```

This re-runs the installer against the latest release. The new version is downloaded and built in a
staging directory first, and only swapped into place once the build succeeds, so a failed download or
build leaves your running installation untouched. Your `data/` directory and `.env` are preserved.

If no published release can be resolved — either the repository has none, or the unauthenticated
GitHub API rate limit was hit — the installer says so and falls back to the `main` branch, which is
development code. Pin a release with `QUESTARR_REF` if you want to avoid that.

To move to a specific version instead:

```bash
pct exec 210 -- env QUESTARR_REF=v1.4.3 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-install.sh)"
```

Take a Proxmox snapshot or backup before updating if you want a quick way back:

```bash
vzdump 210 --mode snapshot --compress zstd
```

## Configuration

All of the options in [`.env.example`](../.env.example) apply. Edit `/opt/questarr/.env` and restart:

```bash
pct exec 210 -- sh -c 'nano /opt/questarr/.env && systemctl restart questarr'
```

IGDB credentials, indexers, and download clients are configured in the web UI under **Settings**, so
you normally do not need to touch `.env` at all.

## Installing into an existing container or VM

`questarr-install.sh` is standalone. If you already have a Debian or Ubuntu LXC (or a plain VM), run
this inside it as `root`:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-install.sh)"
```

It installs the same `systemd` service and `update` helper. It is safe to re-run: it replaces the
application tree while preserving `data/` and `.env`.

## Notes and troubleshooting

- **The service runs unprivileged.** Questarr runs as the `questarr` system user under a hardened
  unit (`ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`), with `/opt/questarr` as the only
  writable path.
- **The install fails at "Waiting for network".** The container could not resolve DNS. Check that the
  bridge you chose is correct and that your static IP and gateway are valid.
- **The install fails during `npm ci` or the build.** Almost always the container ran out of RAM or
  disk. Raise them (`pct set 210 --memory 2048`, `pct resize 210 rootfs +4G`) and re-run `update`.
- **The service will not start.** `pct exec 210 -- journalctl -u questarr -n 50` shows the reason. A
  port already in use and a non-writable `data/` directory are the usual causes.
- **Backups.** `/opt/questarr/data` holds everything that matters. A Proxmox container backup
  (`vzdump`) covers it, as does copying that directory.
