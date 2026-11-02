FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS base
WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache g++ make python3

COPY package*.json ./
RUN npm ci --ignore-scripts

# Prune in its own stage so dev dependencies never end up in a shipped layer
FROM base AS prod-deps
RUN npm prune --omit=dev

FROM base AS builder

COPY . .
RUN npm run build

FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS production

WORKDIR /app

ENV SQLITE_DB_PATH=/app/data/sqlite.db
ENV NODE_ENV=production
ENV PORT=5000
ENV PUID=1000
ENV PGID=1000
ENV UMASK=022

COPY requirements/apprise.txt /tmp/requirements-apprise.txt
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache 7zip curl gcompat py3-pip python3 shadow su-exec && \
    python3 -m pip install --no-cache-dir --break-system-packages --only-binary :all: \
      --require-hashes -r /tmp/requirements-apprise.txt && \
    rm /tmp/requirements-apprise.txt

ARG RARLAB_UNRAR_VERSION=712
ARG RARLAB_UNRAR_SHA256=630d9a9dd131367273667bee079ad103f469f1b7cdbc9b42a4f283cc2993bab2
RUN curl -fsSL --proto '=https' --tlsv1.2 -o /tmp/unrar.tar.gz \
      "https://www.rarlab.com/rar/rarlinux-x64-${RARLAB_UNRAR_VERSION}.tar.gz" && \
    echo "${RARLAB_UNRAR_SHA256}  /tmp/unrar.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/unrar.tar.gz -C /tmp && \
    install -Dm755 /tmp/rar/unrar /usr/local/bin/unrar && \
    rm -rf /tmp/unrar.tar.gz /tmp/rar

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package*.json ./

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/lib/node_modules/corepack

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/migrations-pg ./migrations-pg
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/package.json ./

# Non-recursive chown on purpose: a recursive one duplicates node_modules into a new layer
RUN addgroup questarr && \
    adduser -G questarr -s /bin/sh -D questarr && \
    mkdir -p /app/data && \
    chown questarr:questarr /app /app/data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000

# Starts as root so entrypoint.sh can apply PUID/PGID, then drops privileges via su-exec
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint -- see comment above
ENTRYPOINT ["/entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user -- entrypoint.sh drops to the unprivileged questarr user via su-exec before this CMD ever runs
CMD ["node", "dist/server/index.js"]

LABEL org.opencontainers.image.title="Questarr"
LABEL org.opencontainers.image.description="Questarr is a smart game library manager that automates discovery and downloads, inspired by the *Arr ecosystem."
LABEL org.opencontainers.image.authors="Doezer"
LABEL org.opencontainers.image.source="https://github.com/Doezer/questarr"
LABEL org.opencontainers.image.licenses="GPL-3.0-only"
LABEL org.opencontainers.image.version="1.6.0"
