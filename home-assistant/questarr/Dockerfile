ARG BUILD_FROM=ghcr.io/doezer/questarr:1.4.0
FROM ${BUILD_FROM}

RUN mkdir -p /data

# If the base image has seeded /app/data content, migrate it once to persistent storage.
RUN if [ -d /app/data ] && [ ! -L /app/data ]; then cp -a /app/data/. /data/ && rm -rf /app/data; fi

RUN ln -sfn /data /app/data
