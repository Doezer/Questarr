# Build stage with shared dependencies
FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build stage
FROM base AS builder

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY . .

# Build client and server
RUN npm run build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Set default environment variables
ENV SQLITE_DB_PATH=/app/data/sqlite.db
ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy necessary files from build stage
COPY --from=builder /app/dist ./dist

# Copy drizzle configuration and migrations for production
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/scripts ./scripts

# Copy configuration files
COPY --from=builder /app/package.json ./

# Create a dedicated non-root user and group for better security and auditability
RUN addgroup -g 1000 questarr && adduser -u 1000 -G questarr -s /bin/sh -D questarr

# Create data directory for persistence and set ownership
# Note: if you mount ./data from the host, ensure the host directory is owned by UID 1000
# e.g.: sudo chown -R 1000:1000 ./data
RUN mkdir -p /app/data && chown -R questarr:questarr /app

USER questarr

EXPOSE 5000

CMD ["npm", "run", "start"]

LABEL org.opencontainers.image.title="Questarr"
LABEL org.opencontainers.image.description="A video game management application inspired by the -Arr apps. Track and organize your video game collection with automated discovery and download management."
LABEL org.opencontainers.image.authors="Doezer"
LABEL org.opencontainers.image.source="https://github.com/Doezer/questarr"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.version="1.2.1"