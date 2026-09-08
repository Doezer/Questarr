#!/usr/bin/env bash
#
# Questarr — Proxmox VE LXC deployment script.
#
# Creates a Debian LXC container on a Proxmox VE host and installs Questarr
# into it as a systemd service. No Docker involved.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Doezer/Questarr/main/scripts/proxmox/questarr-lxc.sh)"
#
# Run it on the Proxmox host (the node itself), as root.
#
# Non-interactive use — every prompt has an environment override:
#   CTID=210 CT_HOSTNAME=questarr CORES=2 RAM=2048 DISK=8 BRIDGE=vmbr0 \
#   STORAGE=local-lvm NET=dhcp UNPRIVILEGED=1 QUESTARR_PORT=5000 \
#     bash -c "$(curl -fsSL .../questarr-lxc.sh)" -- --yes
#
# Copyright (C) Doezer — GPL-3.0-or-later

set -Eeuo pipefail

QUESTARR_REPO="${QUESTARR_REPO:-Doezer/Questarr}"
QUESTARR_BRANCH="${QUESTARR_BRANCH:-main}"
QUESTARR_REF="${QUESTARR_REF:-}"
QUESTARR_PORT="${QUESTARR_PORT:-5000}"

# Container defaults. Node builds the client with Vite and type-checks the
# server with tsc during install, so 2 GiB of RAM is the practical floor.
CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-questarr}"
CORES="${CORES:-2}"
RAM="${RAM:-2048}"
SWAP="${SWAP:-512}"
DISK="${DISK:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
NET="${NET:-dhcp}"
GATEWAY="${GATEWAY:-}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
ONBOOT="${ONBOOT:-1}"
CT_PASSWORD="${CT_PASSWORD:-}"

ASSUME_YES=0
for arg in "$@"; do
  case "${arg}" in
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help)
      echo "Usage: questarr-lxc.sh [-y|--yes]"
      echo
      echo "Creates a Debian LXC on this Proxmox VE host and installs Questarr into it."
      echo "Every prompt has an environment override: CTID, CT_HOSTNAME, CORES, RAM,"
      echo "SWAP, DISK, STORAGE, TEMPLATE_STORAGE, BRIDGE, NET, GATEWAY, UNPRIVILEGED,"
      echo "ONBOOT, CT_PASSWORD, QUESTARR_PORT, QUESTARR_REPO, QUESTARR_REF."
      echo
      echo "  -y, --yes   accept every default without prompting"
      exit 0
      ;;
    *) ;;
  esac
done

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

msg() { echo "${BLUE}==>${RESET} $*"; }
ok() { echo "${GREEN} ✔${RESET} $*"; }
warn() { echo "${YELLOW} !${RESET} $*" >&2; }
die() {
  echo "${RED} ✘ $*${RESET}" >&2
  exit 1
}

CREATED_CTID=""
on_error() {
  local code=$?
  echo >&2
  echo "${RED} ✘ Deployment failed (exit ${code}).${RESET}" >&2
  if [ -n "${CREATED_CTID}" ]; then
    warn "Container ${CREATED_CTID} was created but is not fully configured."
    warn "Inspect it with 'pct enter ${CREATED_CTID}', or remove it with 'pct destroy ${CREATED_CTID} --force'."
  fi
  exit "${code}"
}
trap on_error ERR

banner() {
  echo
  echo "${BOLD}  Questarr — Proxmox VE LXC deployment${RESET}"
  echo "  https://github.com/${QUESTARR_REPO}"
  echo
}

# ──────────────────────────────────────────────────────────────
# Preflight
# ──────────────────────────────────────────────────────────────
banner

[ "$(id -u)" -eq 0 ] || die "Run this script as root on the Proxmox VE host."
command -v pveversion >/dev/null 2>&1 ||
  die "Proxmox VE not detected. Run this on the Proxmox host, not inside a container or VM."
command -v pct >/dev/null 2>&1 || die "'pct' not found — is this a Proxmox VE node?"

ok "Proxmox VE $(pveversion | cut -d'/' -f2) detected"

# ──────────────────────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────────────────────
interactive() { [ -r /dev/tty ]; }

ask() {
  # ask <variable-name> <prompt> <default>
  local var="$1" prompt="$2" default="$3" answer
  if [ "${ASSUME_YES}" -eq 1 ] || ! interactive; then
    printf -v "${var}" '%s' "${default}"
    return
  fi
  read -r -p "  ${prompt} [${default}]: " answer </dev/tty || answer=""
  printf -v "${var}" '%s' "${answer:-${default}}"
}

if [ -z "${CTID}" ]; then
  CTID="$(pvesh get /cluster/nextid)"
fi

# Pick a storage that can hold container root filesystems.
list_storage() {
  local content="$1"
  pvesm status -content "${content}" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}'
}

if [ -z "${STORAGE}" ]; then
  STORAGE="$(list_storage rootdir | head -n1)"
  [ -n "${STORAGE}" ] || die "No active storage supports container root filesystems. Set STORAGE=<name>."
fi
if [ -z "${TEMPLATE_STORAGE}" ]; then
  TEMPLATE_STORAGE="$(list_storage vztmpl | head -n1)"
  [ -n "${TEMPLATE_STORAGE}" ] || die "No active storage accepts container templates. Set TEMPLATE_STORAGE=<name>."
fi

echo
echo "${BOLD}Container settings${RESET} (press Enter to accept each default)"
ask CTID "Container ID" "${CTID}"
ask CT_HOSTNAME "Hostname" "${CT_HOSTNAME}"
ask CORES "CPU cores" "${CORES}"
ask RAM "RAM (MiB)" "${RAM}"
ask DISK "Disk (GiB)" "${DISK}"
ask STORAGE "Storage" "${STORAGE}"
ask BRIDGE "Network bridge" "${BRIDGE}"
ask NET "IPv4 (dhcp or CIDR e.g. 192.168.1.50/24)" "${NET}"
if [[ "${NET}" != "dhcp" ]]; then
  if [[ -z "${GATEWAY}" ]]; then
    ask GATEWAY "Gateway" "${GATEWAY}"
  fi
  # Non-interactive runs (--yes, or no /dev/tty) never prompt, so a static
  # address without GATEWAY would otherwise reach pct create silently and
  # leave the container with no default route.
  [[ -n "${GATEWAY}" ]] || die "GATEWAY is required when NET is a static address (not 'dhcp')."
fi
ask QUESTARR_PORT "Questarr HTTP port" "${QUESTARR_PORT}"

pct status "${CTID}" >/dev/null 2>&1 && die "Container ${CTID} already exists."

echo
echo "  ${BOLD}CTID${RESET} ${CTID}   ${BOLD}Host${RESET} ${CT_HOSTNAME}   ${BOLD}${CORES}${RESET} cores   ${BOLD}${RAM}${RESET} MiB   ${BOLD}${DISK}${RESET} GiB on ${BOLD}${STORAGE}${RESET}"
echo "  ${BOLD}Net${RESET}  ${BRIDGE} / ${NET}${GATEWAY:+ gw ${GATEWAY}}   ${BOLD}Port${RESET} ${QUESTARR_PORT}"
echo

if [ "${ASSUME_YES}" -eq 0 ] && interactive; then
  read -r -p "  Create this container? [Y/n]: " confirm </dev/tty || confirm=""
  case "${confirm}" in
    [nN] | [nN][oO]) die "Aborted." ;;
  esac
fi

# ──────────────────────────────────────────────────────────────
# Template
# ──────────────────────────────────────────────────────────────
msg "Refreshing the template catalogue"
pveam update >/dev/null 2>&1 || warn "'pveam update' failed — using the cached catalogue."

# Newest available Debian standard template, preferring the highest release.
TEMPLATE="$(pveam available --section system |
  awk '{print $2}' |
  grep -E '^debian-1[0-9]+-standard' |
  sort -V |
  tail -n1)"
[ -n "${TEMPLATE}" ] || die "No Debian LXC template found in the Proxmox catalogue."

if ! pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | awk '{print $1}' | grep -q "/${TEMPLATE}$"; then
  msg "Downloading ${TEMPLATE} to ${TEMPLATE_STORAGE}"
  pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}" >/dev/null
fi
ok "Template ready: ${TEMPLATE}"

# ──────────────────────────────────────────────────────────────
# Create the container
# ──────────────────────────────────────────────────────────────
if [ "${NET}" = "dhcp" ]; then
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${NET}"
  if [ -n "${GATEWAY}" ]; then
    NET_CONFIG="${NET_CONFIG},gw=${GATEWAY}"
  fi
fi

msg "Creating container ${CTID}"
PCT_ARGS=(
  --hostname "${CT_HOSTNAME}"
  --cores "${CORES}"
  --memory "${RAM}"
  --swap "${SWAP}"
  --rootfs "${STORAGE}:${DISK}"
  --net0 "${NET_CONFIG}"
  --unprivileged "${UNPRIVILEGED}"
  --onboot "${ONBOOT}"
  --features nesting=1
  --ostype debian
  --tags questarr
)
if [ -n "${CT_PASSWORD}" ]; then
  PCT_ARGS+=(--password "${CT_PASSWORD}")
fi

pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" "${PCT_ARGS[@]}" >/dev/null
CREATED_CTID="${CTID}"
ok "Container ${CTID} created"

msg "Starting container ${CTID}"
pct start "${CTID}" >/dev/null

# Wait for the container's network to come up before the installer needs it.
msg "Waiting for network"
for _ in $(seq 1 60); do
  if pct exec "${CTID}" -- getent hosts deb.debian.org >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
pct exec "${CTID}" -- getent hosts deb.debian.org >/dev/null 2>&1 ||
  die "Container ${CTID} has no working DNS/network. Check the ${BRIDGE} bridge and your ${NET} settings."
ok "Network is up"

# ──────────────────────────────────────────────────────────────
# Install Questarr inside the container
# ──────────────────────────────────────────────────────────────
INSTALLER_URL="https://raw.githubusercontent.com/${QUESTARR_REPO}/${QUESTARR_BRANCH}/scripts/proxmox/questarr-install.sh"
LOCAL_INSTALLER="$(dirname "$(readlink -f "$0")")/questarr-install.sh"

msg "Installing Questarr inside container ${CTID}"
if [ -f "${LOCAL_INSTALLER}" ]; then
  # Running from a checkout: use the sibling installer so both halves match.
  pct push "${CTID}" "${LOCAL_INSTALLER}" /root/questarr-install.sh --perms 0755
else
  pct exec "${CTID}" -- bash -c \
    "apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null && curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' '${INSTALLER_URL}' -o /root/questarr-install.sh && chmod 0755 /root/questarr-install.sh"
fi

pct exec "${CTID}" -- env \
  QUESTARR_REPO="${QUESTARR_REPO}" \
  QUESTARR_REF="${QUESTARR_REF}" \
  QUESTARR_PORT="${QUESTARR_PORT}" \
  bash /root/questarr-install.sh

# ──────────────────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────────────────
CT_IP="$(pct exec "${CTID}" -- hostname -I 2>/dev/null | awk '{print $1}')"

echo
ok "${BOLD}Questarr is deployed in LXC ${CTID} (${CT_HOSTNAME}).${RESET}"
# Informational only: this is the address of the user's own freshly created
# container, matching Questarr's own HTTP-by-default listener.
echo "   URL:     http://${CT_IP:-<container-ip>}:${QUESTARR_PORT}" # NOSONAR
echo "   Shell:   pct enter ${CTID}"
echo "   Logs:    pct exec ${CTID} -- journalctl -u questarr -f"
echo "   Update:  pct exec ${CTID} -- update"
echo
