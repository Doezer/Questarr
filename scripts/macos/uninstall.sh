#!/usr/bin/env bash
#
# Stops Questarr and removes the launchd agent and the application files. The data folder
# (database and settings) is kept: delete "~/Library/Application Support/Questarr" to remove it too.

set -euo pipefail

APP_DIR="${HOME}/Library/Application Support/Questarr"
PLIST="${HOME}/Library/LaunchAgents/app.questarr.plist"

launchctl bootout "gui/$(id -u)/app.questarr" 2>/dev/null || true
rm -f "${PLIST}"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} + 2>/dev/null || true

echo "Questarr is stopped and removed. Your data is still in ${APP_DIR}."
