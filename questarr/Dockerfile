# NOSONAR - ha-entrypoint.sh must run as root to chown /data before su-exec drops to questarr
FROM ghcr.io/doezer/questarr:1.4.0
ARG BUILD_ARCH=amd64

LABEL \
    io.hass.name="Questarr" \
    io.hass.description="Video game management for your Home Assistant stack." \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="1.4.0"

RUN mkdir -p /data

# If the base image has seeded /app/data content, migrate it once to persistent storage.
RUN if [ -d /app/data ] && [ ! -L /app/data ]; then cp -a /app/data/. /data/ && rm -rf /app/data; fi

RUN ln -sfn /data /app/data

COPY ha-entrypoint.sh /ha-entrypoint.sh
RUN chmod +x /ha-entrypoint.sh

ENTRYPOINT ["/ha-entrypoint.sh"]
CMD ["npm", "run", "start"]
