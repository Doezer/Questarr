#!/usr/bin/env bash
#
# Installs or updates Questarr from an unpacked release tarball (run it from inside the
# extracted questarr/ directory, as root). Node.js is bundled; only systemd is required.
#
#   tar -xzf questarr-<version>-linux-<x64|arm64>.tar.gz
#   cd questarr && sudo ./install.sh
#
# Environment overrides:
#   QUESTARR_PORT   HTTP port        (default: 5000)
#   QUESTARR_HOST   Bind address     (default: 0.0.0.0)

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/questarr"
APP_USER="questarr"
PORT="${QUESTARR_PORT:-5000}"
HOST="${QUESTARR_HOST:-0.0.0.0}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "Run this installer as root (sudo ./install.sh)."
command -v systemctl >/dev/null || die "systemd is required."
[ -x "${SRC}/node/bin/node" ] && [ -f "${SRC}/dist/server/index.js" ] || die "Run this script from the extracted questarr/ directory."

case "${SRC}/" in
  "${APP_DIR}/"*) die "Extract the archive outside ${APP_DIR} (for example in /tmp or your home directory) and run install.sh from there." ;;
esac

id "${APP_USER}" >/dev/null 2>&1 ||
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"

systemctl stop questarr 2>/dev/null || true

mkdir -p "${APP_DIR}"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} +
cp -a "${SRC}/dist" "${SRC}/migrations" "${SRC}/migrations-pg" "${SRC}/shared" \
  "${SRC}/node_modules" "${SRC}/node" "${SRC}/package.json" "${SRC}/VERSION" "${SRC}/.env.example" "${APP_DIR}/"
mkdir -p "${APP_DIR}/data"
ln -sfn "${APP_DIR}/data/server.log" "${APP_DIR}/server.log"

if [ ! -f "${APP_DIR}/.env" ]; then
  cat >"${APP_DIR}/.env" <<ENVEOF
NODE_ENV=production
PORT=${PORT}
HOST=${HOST}
SQLITE_DB_PATH=${APP_DIR}/data/sqlite.db
ENVEOF
fi

chown -R root:root "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/data"
chown root:"${APP_USER}" "${APP_DIR}/.env"
chmod 0640 "${APP_DIR}/.env"

install -m 0644 "${SRC}/questarr.service" /etc/systemd/system/questarr.service
systemctl daemon-reload
systemctl enable -q questarr
systemctl restart questarr

PORT="$(sed -n 's/^PORT=//p' "${APP_DIR}/.env" | tail -n1)"
PORT="${PORT:-5000}"

echo "Questarr $(cat "${APP_DIR}/VERSION") is installed and running."
echo "  URL:    http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}"
echo "  Config: ${APP_DIR}/.env"
echo "  Data:   ${APP_DIR}/data"
echo "  Logs:   journalctl -u questarr -f"
echo "  Library and download folders: the service writes there as user ${APP_USER}, so grant that user"
echo "  filesystem permissions. Folders under /home are read-only for the service; to allow them run"
echo "  systemctl edit questarr and add"
echo "    [Service]"
echo "    ReadWritePaths=/path/to/library /path/to/downloads"
