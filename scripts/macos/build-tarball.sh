#!/usr/bin/env bash
#
# Builds the macOS release tarball for the CPU architecture it runs on.
#
#   scripts/macos/build-tarball.sh [output-dir]
#
# Produces questarr-<version>-macos-<x64|arm64>.tar.gz and a matching .sha256 file.
# better-sqlite3 is compiled for the Node.js that runs this script, so the tarball ships that
# exact Node.js binary: no Node.js is needed on the Mac, and the ABI always matches.
# Build on the target architecture (Apple silicon for arm64, an Intel runner for x64).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$(mkdir -p "${1:-${ROOT}/release-assets}" && cd "${1:-${ROOT}/release-assets}" && pwd)"

case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VERSION="$(node -p "require('${ROOT}/package.json').version")"
NAME="questarr-${VERSION}-macos-${ARCH}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
PKG="${STAGE}/questarr"

cd "${ROOT}"
npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run build
npm prune --omit=dev

mkdir -p "${PKG}"
cp -R dist migrations migrations-pg shared node_modules package.json "${PKG}/"
mkdir -p "${PKG}/node/bin"
cp "$(node -p process.execPath)" "${PKG}/node/bin/node"
cp .env.example "${PKG}/.env.example"
cp scripts/macos/install.sh scripts/macos/uninstall.sh "${PKG}/"
chmod 0755 "${PKG}/install.sh" "${PKG}/uninstall.sh"
echo "${VERSION}" >"${PKG}/VERSION"

COPYFILE_DISABLE=1 tar -C "${STAGE}" --uid 0 --gid 0 --numeric-owner -czf "${OUT_DIR}/${NAME}.tar.gz" questarr
(cd "${OUT_DIR}" && shasum -a 256 "${NAME}.tar.gz" >"${NAME}.tar.gz.sha256")

echo "Built ${OUT_DIR}/${NAME}.tar.gz"
