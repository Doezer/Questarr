#!/usr/bin/env bash
#
# Builds the Linux release tarball for the CPU architecture it runs on.
#
#   scripts/linux/build-tarball.sh [output-dir]
#
# Produces questarr-<version>-linux-<x64|arm64>.tar.gz and a matching .sha256 file.
# better-sqlite3 is compiled for the Node.js that runs this script, so the tarball ships that
# exact Node.js binary: no Node.js is needed on the host, and the ABI always matches.
# Build on the target architecture, on the oldest distribution you want to support (glibc).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$(mkdir -p "${1:-${ROOT}/release-assets}" && cd "${1:-${ROOT}/release-assets}" && pwd)"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VERSION="$(node -p "require('${ROOT}/package.json').version")"
NAME="questarr-${VERSION}-linux-${ARCH}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
PKG="${STAGE}/questarr"

cd "${ROOT}"
npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run build
npm prune --omit=dev

mkdir -p "${PKG}"
cp -a dist migrations migrations-pg shared node_modules package.json "${PKG}/"
mkdir -p "${PKG}/node/bin"
cp "$(node -p process.execPath)" "${PKG}/node/bin/node"
cp .env.example "${PKG}/.env.example"
cp scripts/linux/install.sh scripts/linux/questarr.service "${PKG}/"
chmod 0755 "${PKG}/install.sh"
echo "${VERSION}" >"${PKG}/VERSION"

tar -C "${STAGE}" --owner=0 --group=0 --numeric-owner -czf "${OUT_DIR}/${NAME}.tar.gz" questarr
(cd "${OUT_DIR}" && sha256sum "${NAME}.tar.gz" >"${NAME}.tar.gz.sha256")

echo "Built ${OUT_DIR}/${NAME}.tar.gz"
