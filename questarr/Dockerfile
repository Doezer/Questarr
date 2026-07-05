# NOSONAR - ha-entrypoint.sh must run as root to chown /data before su-exec drops to questarr
ARG QUESTARR_VERSION=1.4.0
FROM ghcr.io/doezer/questarr:${QUESTARR_VERSION}
ARG BUILD_ARCH=amd64

LABEL \
    io.hass.name="Questarr" \
    io.hass.description="Arr-inspired game management with discovery, tracking, and automated downloads." \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${QUESTARR_VERSION}"

RUN mkdir -p /data

# If the base image has seeded /app/data content, migrate it once to persistent storage.
RUN if [ -d /app/data ] && [ ! -L /app/data ]; then cp -a /app/data/. /data/ && rm -rf /app/data; fi

RUN ln -sfn /data /app/data

COPY ha-entrypoint.sh /ha-entrypoint.sh
RUN chmod +x /ha-entrypoint.sh

# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint -- ha-entrypoint.sh must run as root first, then drops privileges with su-exec
ENTRYPOINT ["/ha-entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user -- runtime process is exec'd as the unprivileged questarr user by ha-entrypoint.sh
CMD ["npm", "run", "start"]
