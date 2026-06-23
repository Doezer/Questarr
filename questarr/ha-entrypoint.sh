#!/bin/sh
set -e

# On Home Assistant, /data is mounted at runtime and is initially root-owned.
# The base entrypoint's find-based chown only scans children of /data, not /data
# itself, so a fresh empty mount is never fixed and Questarr can't write sqlite.db.
# Explicitly fix the directory ownership here before handing off to the base entrypoint.
chown questarr:questarr /data 2>/dev/null || true

exec /entrypoint.sh "$@"
