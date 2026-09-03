#!/usr/bin/env bash
#
# Questarr in-container installer.
#
# Installs Questarr from source into /opt/questarr and runs it as a systemd
# service. Intended to be executed as root inside a freshly created Debian or
# Ubuntu LXC container (see questarr-lxc.sh), but it works just as well on any
# bare Debian/Ubuntu VM or host.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-install.sh)"
#
# Environment overrides:
#   QUESTARR_REPO    GitHub repository            (default: Doezer/Questarr)
#   QUESTARR_REF     Tag/branch to install        (default: latest release, else main)
#   QUESTARR_PORT    HTTP port                    (default: 5000)
#   QUESTARR_HOST    Bind address                 (default: 0.0.0.0)
#   NODE_MAJOR       Node.js major version        (default: 22)
#
# Copyright (C) Doezer — GPL-3.0-or-later

set -euo pipefail

QUESTARR_REPO="${QUESTARR_REPO:-Doezer/Questarr}"
QUESTARR_REF="${QUESTARR_REF:-}"
QUESTARR_PORT="${QUESTARR_PORT:-5000}"
QUESTARR_HOST="${QUESTARR_HOST:-0.0.0.0}"
NODE_MAJOR="${NODE_MAJOR:-22}"

APP_DIR="/opt/questarr"
DATA_DIR="${APP_DIR}/data"
APP_USER="questarr"
VERSION_FILE="${APP_DIR}/.questarr_version"
STAGE_DIR="/opt/.questarr-stage"

# curl follows redirects (-L) for every download below, so pin both the initial
# request and any redirect to HTTPS. Without --proto-redir a redirect could
# downgrade to plaintext, and these downloads are piped into gpg and bash.
CURL_OPTS=(--fail --silent --show-error --location --proto '=https' --proto-redir '=https')

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
RESET=$'\033[0m'

msg() { echo "${BLUE}==>${RESET} $*"; }
ok() { echo "${GREEN} ✔${RESET} $*"; }
warn() { echo "${YELLOW} !${RESET} $*" >&2; }
die() {
  echo "${RED} ✘ $*${RESET}" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "This installer must run as root."

# ──────────────────────────────────────────────────────────────
# 1. OS packages
# ──────────────────────────────────────────────────────────────
# build-essential + python3 are needed because npm runs node-gyp's configure
# step for better-sqlite3 on install, even when it ends up using a prebuilt
# binary and never compiles anything (same reasoning as the Dockerfile).
msg "Installing OS dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg git tar jq \
  build-essential python3 >/dev/null
ok "OS dependencies installed"

# ──────────────────────────────────────────────────────────────
# 2. Node.js
# ──────────────────────────────────────────────────────────────
install_node() {
  msg "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl "${CURL_OPTS[@]}" https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  ok "Node.js $(node -v) installed"
}

if command -v node >/dev/null 2>&1 &&
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "${NODE_MAJOR}" ]; then
  ok "Node.js $(node -v) already present"
else
  install_node
fi

# ──────────────────────────────────────────────────────────────
# 3. Service account
# ──────────────────────────────────────────────────────────────
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  msg "Creating service account '${APP_USER}'"
  useradd --system --create-home --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${APP_DIR}" "${DATA_DIR}"

# ──────────────────────────────────────────────────────────────
# 4. Fetch the source
# ──────────────────────────────────────────────────────────────
resolve_ref() {
  if [ -n "${QUESTARR_REF}" ]; then
    echo "${QUESTARR_REF}"
    return
  fi
  local tag
  tag=$(curl "${CURL_OPTS[@]}" "https://api.github.com/repos/${QUESTARR_REPO}/releases/latest" 2>/dev/null |
    jq -r '.tag_name // empty' 2>/dev/null || true)
  if [ -z "${tag}" ]; then
    # No published release, or the unauthenticated GitHub API rate limit was hit
    # (60 requests/hour per IP). Fall back to the default branch rather than
    # failing, but say so — main is development code, not a release.
    warn "Could not determine the latest release; installing from 'main' instead."
    warn "Pin a version with QUESTARR_REF=<tag> if you want a released build."
    echo "main"
    return
  fi
  echo "${tag}"
}

REF="$(resolve_ref)"
msg "Installing Questarr ${REF} from ${QUESTARR_REPO}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}" "${STAGE_DIR}"; }
trap cleanup EXIT

TARBALL="${TMP_DIR}/questarr.tar.gz"
curl "${CURL_OPTS[@]}" "https://codeload.github.com/${QUESTARR_REPO}/tar.gz/${REF}" -o "${TARBALL}" ||
  die "Could not download ${QUESTARR_REPO} at ref '${REF}'."
# Clear any leftovers from a previous run that died before its cleanup trap.
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
tar -xzf "${TARBALL}" -C "${STAGE_DIR}" --strip-components=1

# ──────────────────────────────────────────────────────────────
# 5. Build (in a staging directory)
# ──────────────────────────────────────────────────────────────
# Everything is built before the live application tree is touched, so a failed
# download or build on an update leaves the running installation intact.
msg "Installing npm dependencies (this takes a few minutes)"
cd "${STAGE_DIR}"
# --ignore-scripts skips husky's prepare hook, which needs a git repo that the
# release tarball is not.
npm ci --no-audit --no-fund --ignore-scripts >/dev/null
# better-sqlite3 ships prebuilt bindings for every supported platform inside the
# npm package, so this is a no-op today. It stays as a safety net: if a future
# release drops the bundled prebuild, this fetches or compiles the binding
# instead of failing at first database access.
npm rebuild better-sqlite3 >/dev/null
node -e 'require("better-sqlite3")' ||
  die "better-sqlite3 native binding is unusable — the install cannot continue."
ok "Dependencies installed"

msg "Building Questarr"
npm run build >/dev/null
ok "Build complete"

msg "Pruning development dependencies"
npm prune --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null

# ──────────────────────────────────────────────────────────────
# 5b. Swap the freshly built tree into place
# ──────────────────────────────────────────────────────────────
cd /
if systemctl is-active --quiet questarr 2>/dev/null; then
  msg "Stopping questarr for the swap"
  systemctl stop questarr
fi

msg "Installing to ${APP_DIR}"
# Replace the application tree while keeping the operator's data and config.
find "${APP_DIR}" -mindepth 1 -maxdepth 1 \
  ! -name data ! -name .env ! -name .questarr_version -exec rm -rf {} +
cp -a "${STAGE_DIR}/." "${APP_DIR}/"
echo "${REF}" >"${VERSION_FILE}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
rm -rf "${STAGE_DIR}"

# ──────────────────────────────────────────────────────────────
# 6. Configuration
# ──────────────────────────────────────────────────────────────
# Written once and never overwritten, so an update keeps the operator's edits.
if [ ! -f "${APP_DIR}/.env" ]; then
  msg "Writing default configuration to ${APP_DIR}/.env"
  cat >"${APP_DIR}/.env" <<EOF
# Questarr configuration — see .env.example in the repo for every option.
NODE_ENV=production
PORT=${QUESTARR_PORT}
HOST=${QUESTARR_HOST}
SQLITE_DB_PATH=${DATA_DIR}/sqlite.db
EOF
fi
chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
chmod 0640 "${APP_DIR}/.env"

# ──────────────────────────────────────────────────────────────
# 7. systemd service
# ──────────────────────────────────────────────────────────────
msg "Installing systemd service"
cat >/etc/systemd/system/questarr.service <<EOF
[Unit]
Description=Questarr — game library manager
Documentation=https://github.com/${QUESTARR_REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/dist/server/index.js
Restart=on-failure
RestartSec=10

# Hardening. Questarr writes its SQLite database to data/ and a server.log to
# its working directory, so ${APP_DIR} is the only writable path it needs.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable -q questarr
systemctl restart questarr
ok "questarr.service enabled and started"

# ──────────────────────────────────────────────────────────────
# 8. Updater helper
# ──────────────────────────────────────────────────────────────
# Matches the Proxmox helper-script convention: `update` inside the container.
cat >/usr/bin/update <<EOF
#!/usr/bin/env bash
set -euo pipefail
QUESTARR_REPO="${QUESTARR_REPO}" \\
QUESTARR_PORT="${QUESTARR_PORT}" \\
QUESTARR_HOST="${QUESTARR_HOST}" \\
NODE_MAJOR="${NODE_MAJOR}" \\
  bash -c "\$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/${QUESTARR_REPO}/main/scripts/proxmox/questarr-install.sh)"
EOF
chmod 0755 /usr/bin/update

# ──────────────────────────────────────────────────────────────
# 9. Done
# ──────────────────────────────────────────────────────────────
apt-get -y -qq autoremove >/dev/null
apt-get -y -qq clean

IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
ok "Questarr ${REF} is installed."
echo "   URL:      http://${IP_ADDR:-<container-ip>}:${QUESTARR_PORT}"
echo "   Config:   ${APP_DIR}/.env"
echo "   Data:     ${DATA_DIR}"
echo "   Logs:     journalctl -u questarr -f"
echo "   Update:   run 'update' inside this container"
echo

if ! systemctl is-active --quiet questarr; then
  warn "questarr.service is not active yet — check 'journalctl -u questarr -n 50'."
fi
