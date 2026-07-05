# Build stage with shared dependencies
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build client and server
FROM base AS builder

COPY . .
RUN npm run build

# Production stage
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS production

WORKDIR /app

# Set default environment variables
ENV SQLITE_DB_PATH=/app/data/sqlite.db
ENV NODE_ENV=production
ENV PORT=5000
ENV PUID=1000
ENV PGID=1000

# Install su-exec (for privilege dropping) and shadow (for usermod/groupmod)
RUN apk add --no-cache su-exec shadow

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
LABEL org.opencontainers.image.version="1.4.0"
