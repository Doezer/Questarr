# Reverse Proxy & Subdirectory Deployment

Questarr can be served from a subdirectory (e.g. `https://xxx.domain.com/Questarr`)
behind a reverse proxy, instead of owning its own subdomain or root path.

## How it works

- The client build uses relative asset paths by default and detects its own
  base path at runtime, so it doesn't need to know about the subdirectory in
  advance.
- The server understands an optional `QUESTARR_BASE_PATH` environment
  variable. When set, it mounts the entire app (API, WebSocket, and static
  assets) under that prefix, so a reverse proxy can forward requests straight
  through without rewriting the path.

Setting `QUESTARR_BASE_PATH` is only required if you want Questarr itself to
own the prefix (recommended — see below). If you'd rather have your reverse
proxy strip the prefix before forwarding to Questarr, you can leave
`QUESTARR_BASE_PATH` unset; the client's runtime base-path detection adapts
either way.

## 1. Configure Questarr

Set `QUESTARR_BASE_PATH` to the path you want to serve from (leading slash,
no trailing slash — e.g. `/Questarr`):

**Docker Compose:**

```yaml
services:
  app:
    image: ghcr.io/doezer/questarr:latest
    environment:
      - QUESTARR_BASE_PATH=/Questarr
    # ...
```

**`docker run`:**

```bash
docker run -e QUESTARR_BASE_PATH=/Questarr ghcr.io/doezer/questarr:latest
```

**npm (non-Docker):** add `QUESTARR_BASE_PATH=/Questarr` to your `.env` file.

With this set, Questarr:

- Serves the app and all `/api/*` routes under `/Questarr/*`
- Redirects the unprefixed root (`/`) to `/Questarr/`
- Keeps `/api/health` reachable unprefixed too, so container healthchecks
  (which talk to the container directly, not through the proxy) keep working
  unmodified
- Serves the WebSocket (Socket.IO) connection at `/Questarr/socket.io/`

## 2. Configure your reverse proxy

Point requests under the prefix at the Questarr container/process, **without
stripping the prefix** — Questarr expects to see it.

### nginx

`app` below is the Compose service name from this repo's `docker-compose.yml`
— substitute your own container/service name if it differs. nginx's prefix
match only covers `/Questarr/...`, so add an exact-match redirect for the
bare `/Questarr` (no trailing slash) case too:

```nginx
location = /Questarr {
    return 301 /Questarr/;
}

location /Questarr/ {
    proxy_pass http://app:5000/Questarr/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Required for Socket.IO (real-time download/notification updates)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Traefik (labels)

```yaml
labels:
  - "traefik.http.routers.questarr.rule=Host(`xxx.domain.com`) && PathPrefix(`/Questarr`)"
  - "traefik.http.services.questarr.loadbalancer.server.port=5000"
```

No `StripPrefix` middleware needed — Questarr handles the prefix itself.

### Caddy

Caddy's `/Questarr/*` matcher is exact-prefix and won't match the bare
`/Questarr` (no trailing slash) request, so redirect it explicitly:

```caddyfile
xxx.domain.com {
    redir /Questarr /Questarr/ permanent
    reverse_proxy /Questarr/* app:5000
}
```

## 3. Verify

Visit `https://xxx.domain.com/Questarr/`. Login, navigation, API calls, and
real-time download/notification updates should all work normally under the
prefix.

## Notes

- `QUESTARR_BASE_PATH` accepts letters, numbers, hyphens, underscores, and
  slashes only (e.g. `/Questarr`, `/games/questarr`). Invalid values fail
  startup with a clear error, the same way other misconfigured environment
  variables do.
- Changing `QUESTARR_BASE_PATH` only affects the running server — no rebuild
  is required, since the pre-built Docker image resolves the base path at
  runtime rather than baking it into the client bundle at build time.
