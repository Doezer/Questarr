# Install all dependencies (dev + prod) for building
FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build client and server
FROM base AS builder

WORKDIR /app

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS production

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

# Copy drizzle configuration and migrations for production
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/scripts ./scripts

# Copy configuration files...
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

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "start"]

LABEL org.opencontainers.image.title="Questarr"
LABEL org.opencontainers.image.description="A video game management application inspired by the -Arr apps. Track and organize your video game collection with automated discovery and download management."
LABEL org.opencontainers.image.authors="Doezer"
LABEL org.opencontainers.image.source="https://github.com/Doezer/questarr"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.version="1.3.0"
