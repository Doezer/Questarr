#!/bin/sh
set -e

# ──────────────────────────────────────────────────────────────
# PUID / PGID handling (LinuxServer.io / *-arr convention)
# Allows the container to run with the host user's UID/GID
# so that mounted volumes have correct ownership.
# ──────────────────────────────────────────────────────────────

PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "───────────────────────────────────────"
echo "  Questarr — Starting container"
echo "  PUID: ${PUID}"
echo "  PGID: ${PGID}"
echo "───────────────────────────────────────"

# Adjust the questarr group GID if it differs from PGID
CURRENT_GID=$(id -g questarr)
if [ "$CURRENT_GID" != "$PGID" ]; then
  echo "Updating questarr group GID from ${CURRENT_GID} to ${PGID}"
  groupmod -o -g "$PGID" questarr
fi

# Adjust the questarr user UID if it differs from PUID
CURRENT_UID=$(id -u questarr)
if [ "$CURRENT_UID" != "$PUID" ]; then
  echo "Updating questarr user UID from ${CURRENT_UID} to ${PUID}"
  usermod -o -u "$PUID" questarr
fi

# Ensure the data directory exists and key directories are owned by the correct user
mkdir -p /app/data

QUESTARR_UID=$(id -u questarr)
QUESTARR_GID=$(id -g questarr)

# Only chown /app if ownership does not already match (avoids failures on NFS with root squash)
APP_OWNER_UID=$(stat -c '%u' /app)
APP_OWNER_GID=$(stat -c '%g' /app)
if [ "$APP_OWNER_UID" != "$QUESTARR_UID" ] || [ "$APP_OWNER_GID" != "$QUESTARR_GID" ]; then
  echo "Setting ownership of /app to questarr:questarr"
  chown questarr:questarr /app
fi

# Only chown /app/data if the directory itself or any nested file/dir has wrong ownership.
# Scanning recursively catches post-restore trees where the top-level inode matches but
# inner files were created by a different host UID/GID.
# -print -quit stops at the first mismatch so this is fast even on large trees.
if find /app/data \( ! -uid "$QUESTARR_UID" -o ! -gid "$QUESTARR_GID" \) -print -quit 2>/dev/null | grep -q .; then
  echo "Setting ownership of /app/data to questarr:questarr"
  chown -R questarr:questarr /app/data
fi

# Drop root privileges and exec the CMD as questarr
exec su-exec questarr "$@"
