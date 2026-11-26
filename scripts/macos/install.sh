#!/usr/bin/env bash
#
# Installs or updates Questarr from an unpacked macOS release tarball, for the current user
# (no sudo). Questarr runs as a launchd agent that starts at login. Node.js is bundled.
#
#   tar -xzf questarr-<version>-macos-<arm64|x64>.tar.gz
#   cd questarr && ./install.sh
#
# Environment overrides:
#   QUESTARR_PORT   HTTP port     (default: 5000)
#   QUESTARR_HOST   Bind address  (default: 127.0.0.1, this Mac only; use 0.0.0.0 for your network)

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${HOME}/Library/Application Support/Questarr"
LOG_DIR="${HOME}/Library/Logs/Questarr"
PLIST="${HOME}/Library/LaunchAgents/app.questarr.plist"
LABEL="app.questarr"
PORT="${QUESTARR_PORT:-5000}"
HOST="${QUESTARR_HOST:-127.0.0.1}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS."
[ "$(id -u)" -ne 0 ] || die "Run this installer as your normal user, not with sudo."
[ -x "${SRC}/node/bin/node" ] && [ -f "${SRC}/dist/server/index.js" ] || die "Run this script from the extracted questarr/ directory."

case "${SRC}/" in
  "${APP_DIR}/"*) die "Extract the archive outside ${APP_DIR} (for example in ~/Downloads) and run install.sh from there." ;;
esac

xattr -dr com.apple.quarantine "${SRC}" 2>/dev/null || true

STAGE="${APP_DIR}.staging"
rm -rf "${STAGE}"
mkdir -p "${STAGE}" "${LOG_DIR}" "${HOME}/Library/LaunchAgents"
cp -R "${SRC}/dist" "${SRC}/migrations" "${SRC}/migrations-pg" "${SRC}/shared" \
  "${SRC}/node_modules" "${SRC}/node" "${SRC}/package.json" "${SRC}/VERSION" "${SRC}/.env.example" "${STAGE}/"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

mkdir -p "${APP_DIR}"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} +
find "${STAGE}" -mindepth 1 -maxdepth 1 -exec mv {} "${APP_DIR}/" \;
rmdir "${STAGE}"
mkdir -p "${APP_DIR}/data"

if [ ! -f "${APP_DIR}/.env" ]; then
  cat >"${APP_DIR}/.env" <<ENVEOF
NODE_ENV=production
PORT=${PORT}
HOST=${HOST}
SQLITE_DB_PATH=${APP_DIR}/data/sqlite.db
ENVEOF
  chmod 0600 "${APP_DIR}/.env"
fi

XML_APP_DIR="$(xml_escape "${APP_DIR}")"
XML_LOG_DIR="$(xml_escape "${LOG_DIR}")"
cat >"${PLIST}" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${XML_APP_DIR}/node/bin/node</string>
    <string>${XML_APP_DIR}/dist/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${XML_APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${XML_LOG_DIR}/questarr.log</string>
  <key>StandardErrorPath</key>
  <string>${XML_LOG_DIR}/questarr.log</string>
</dict>
</plist>
PLISTEOF

started=0
for _ in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "${PLIST}" 2>/dev/null; then
    started=1
    break
  fi
  sleep 1
done
[ "${started}" -eq 1 ] || die "Could not start the launchd agent. Try: launchctl bootstrap gui/$(id -u) \"${PLIST}\""

PORT="$(sed -n 's/^PORT=//p' "${APP_DIR}/.env" | tail -n1)"
PORT="${PORT:-5000}"

echo "Questarr $(cat "${APP_DIR}/VERSION") is installed and running."
echo "  URL:    http://localhost:${PORT}"
echo "  Config: ${APP_DIR}/.env"
echo "  Data:   ${APP_DIR}/data"
echo "  Logs:   tail -f \"${LOG_DIR}/questarr.log\""
echo "  Stop:   launchctl bootout gui/$(id -u)/${LABEL}"
echo "  Remove: run ./uninstall.sh from this directory (your data is kept)"
echo "  macOS may ask once to allow Questarr to access folders such as Downloads or an external drive."
