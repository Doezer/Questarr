# Build stage with shared dependencies
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS base
WORKDIR /app

# better-sqlite3 bundles a prebuilt binary for this platform, so no C++
# compilation ever happens, but npm's implicit `node-gyp rebuild` still runs
# unconditionally on install (before it evaluates the prebuild and no-ops the
# actual build), and node-gyp's configure step is Python-based, so Python and
# a toolchain remain required regardless.
RUN apk add --no-cache g++ make python3

COPY package*.json ./
RUN npm ci --ignore-scripts

# Build client and server
FROM base AS builder

COPY . .
RUN npm run build

# Production stage
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS production

WORKDIR /app

# Set default environment variables
ENV SQLITE_DB_PATH=/app/data/sqlite.db
ENV NODE_ENV=production
ENV PORT=5000
ENV PUID=1000
ENV PGID=1000
ENV UMASK=022

# Install su-exec (for privilege dropping), shadow (for usermod/groupmod), 7zip (Alpine's
# own musl-native 7-Zip build for .zip/.7z/.iso/.tar/.gz/.bz2 — replaces the glibc-linked
# 7za that the npm 7zip-bin package bundles, which can never execute on this musl-only base
# image: there's no /lib64/ld-linux-x86-64.so.2 for it, so every run fails with ENOENT
# regardless of the executable bit — see ArchiveService.ts), gcompat (glibc compatibility
# shim, needed below to run RARLAB's official unrar binary), curl (to fetch that binary
# with strict HTTPS enforcement, see below), and Python + Apprise for local CLI
# notifications.
RUN apk add --no-cache 7zip curl gcompat py3-pip python3 shadow su-exec && \
    python3 -m pip install --no-cache-dir --break-system-packages apprise==1.9.4

# Fetch RARLAB's official unrar binary for RAR extraction (legacy and RAR5, including
# multi-volume sets). Alpine dropped its own `unrar` package because RARLAB's license
# doesn't meet Alpine's packaging policy for main/community — the binary itself remains
# free to use and redistribute, so we bundle it directly instead. Pinned to an exact
# version for reproducible builds; gcompat above provides the glibc dynamic loader this
# binary needs on musl. `--proto '=https'` makes curl refuse to follow a redirect to
# anything but https, so a compromised or misconfigured redirect can't silently downgrade
# this download to plaintext.
# SECURITY NOTE: rarlab.com was unreachable from the environment this change was authored
# in, so no checksum is pinned here — verify and add one (`curl -fsSL "$url" | sha256sum`)
# before relying on this in production.
ARG RARLAB_UNRAR_VERSION=712
RUN curl -fsSL --proto '=https' --tlsv1.2 -o /tmp/unrar.tar.gz \
      "https://www.rarlab.com/rar/rarlinux-x64-${RARLAB_UNRAR_VERSION}.tar.gz" && \
    tar -xzf /tmp/unrar.tar.gz -C /tmp && \
    install -Dm755 /tmp/rar/unrar /usr/local/bin/unrar && \
    rm -rf /tmp/unrar.tar.gz /tmp/rar

# Reuse node_modules from base and prune dev dependencies (avoids a second npm ci)
COPY --from=base /app/node_modules ./node_modules
COPY package*.json ./

RUN npm prune --omit=dev

# Copy necessary files from build stage
COPY --from=builder /app/dist ./dist

COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/package.json ./

# Create user, group, data directory, and set ownership
RUN addgroup questarr && \
    adduser -G questarr -s /bin/sh -D questarr && \
    mkdir -p /app/data && \
    chown -R questarr:questarr /app

# Copy and set up entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000

# No USER instruction here by design: the container must start as root so
# entrypoint.sh can chown/usermod /app and /app/data to the host-provided
# PUID/PGID (LinuxServer.io convention for bind-mounted volumes), then it
# drops privileges itself via `su-exec questarr` before exec'ing CMD (see
# entrypoint.sh's final line).
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint -- see comment above
ENTRYPOINT ["/entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user -- entrypoint.sh drops to the unprivileged questarr user via su-exec before this CMD ever runs
CMD ["npm", "run", "start"]

LABEL org.opencontainers.image.title="Questarr"
LABEL org.opencontainers.image.description="Questarr is a smart game library manager that automates discovery and downloads, inspired by the *Arr ecosystem."
LABEL org.opencontainers.image.authors="Doezer"
LABEL org.opencontainers.image.source="https://github.com/Doezer/questarr"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.version="1.4.3"
