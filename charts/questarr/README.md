# Questarr Helm chart

Runs [Questarr](https://github.com/Doezer/questarr) on Kubernetes from the official
`ghcr.io/doezer/questarr` image.

The chart deploys a single-replica Deployment, a Service, an optional Ingress, and a
PersistentVolumeClaim for `/app/data` (SQLite database, `config.yaml`, and any other
state Questarr persists).

## Requirements

- Kubernetes >= 1.23
- Helm >= 3.8
- A StorageClass able to provision a ReadWriteOnce volume (unless you bring your own PVC)

## Install

The chart is not published to a Helm repository yet — install it from a clone of the
repository:

```bash
git clone https://github.com/Doezer/questarr.git
cd questarr
helm install questarr charts/questarr --namespace questarr --create-namespace
```

Then reach the UI (the release notes print the exact command for your Service type):

```bash
kubectl port-forward -n questarr svc/questarr 5000:5000
```

The first account created in the UI becomes the administrator.

## Single replica, by design

Questarr keeps all of its state in one SQLite database on a ReadWriteOnce volume. A
second replica would corrupt it, so the chart refuses to render with `replicaCount`
above `1`, and uses the `Recreate` strategy so two pods never hold the volume at once.

## Configuration

### Image and release

| Key                | Default                   | Description                                     |
| ------------------ | ------------------------- | ----------------------------------------------- |
| `image.repository` | `ghcr.io/doezer/questarr` | Image repository                                |
| `image.tag`        | `""`                      | Image tag; defaults to the chart's `appVersion` |
| `image.pullPolicy` | `IfNotPresent`            | Image pull policy                               |
| `imagePullSecrets` | `[]`                      | Pull secrets for private registries             |
| `replicaCount`     | `1`                       | Must stay `1` (see above)                       |
| `strategy`         | `{type: Recreate}`        | Deployment update strategy                      |
| `nameOverride`     | `""`                      | Overrides the chart name                        |
| `fullnameOverride` | `""`                      | Overrides the generated resource names          |

### Application

| Key                       | Default               | Description                                                        |
| ------------------------- | --------------------- | ------------------------------------------------------------------ |
| `questarr.port`           | `5000`                | HTTP port the server listens on (`PORT`)                           |
| `questarr.puid`           | `1000`                | UID the app runs as, applied by the container entrypoint           |
| `questarr.pgid`           | `1000`                | GID the app runs as                                                |
| `questarr.umask`          | `"022"`               | umask for files the app creates                                    |
| `questarr.basePath`       | `""`                  | Serve from a subdirectory (`QUESTARR_BASE_PATH`), e.g. `/questarr` |
| `questarr.timezone`       | `""`                  | Container timezone (`TZ`)                                          |
| `questarr.databasePath`   | `/app/data/sqlite.db` | SQLite path (`SQLITE_DB_PATH`); must live under `/app/data`        |
| `questarr.allowedOrigins` | `""`                  | Extra CORS origins (`ALLOWED_ORIGINS`), comma separated            |
| `questarr.appUrl`         | `""`                  | Public URL used in notification links (`APP_URL`)                  |
| `extraEnv`                | `[]`                  | Extra environment variables, in the `name`/`value` container form  |
| `extraEnvFrom`            | `[]`                  | Extra `envFrom` sources (ConfigMaps / Secrets)                     |

### Secrets

Every secret is optional: Questarr generates and persists its own `JWT_SECRET` and
`CREDENTIALS_ENCRYPTION_KEY` when they are unset, and the API keys can also be entered
in Settings → Services.

| Key                                         | Default           | Description                                               |
| ------------------------------------------- | ----------------- | --------------------------------------------------------- |
| `questarr.existingSecret`                   | `""`              | Read the secrets from this Secret instead of creating one |
| `questarr.existingSecretKeys`               | see `values.yaml` | Secret key holding each value (the env var name is fixed) |
| `questarr.secrets.jwtSecret`                | `""`              | `JWT_SECRET`                                              |
| `questarr.secrets.credentialsEncryptionKey` | `""`              | `CREDENTIALS_ENCRYPTION_KEY`, 64 hex chars                |
| `questarr.secrets.igdbClientId`             | `""`              | `IGDB_CLIENT_ID`                                          |
| `questarr.secrets.igdbClientSecret`         | `""`              | `IGDB_CLIENT_SECRET`                                      |
| `questarr.secrets.nexusmodsApiKey`          | `""`              | `NEXUSMODS_API_KEY`                                       |

Values under `questarr.secrets` end up in a chart-managed Secret, which means they also
sit in the Helm release data. For anything you would rather not put in a values file,
create the Secret yourself and point the chart at it:

```bash
kubectl create secret generic questarr-secrets \
  --namespace questarr \
  --from-literal=IGDB_CLIENT_ID=... \
  --from-literal=IGDB_CLIENT_SECRET=... \
  --from-literal=CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -hex 32)"

helm install questarr charts/questarr --namespace questarr \
  --set questarr.existingSecret=questarr-secrets
```

Keys absent from that Secret are injected as `optional`, so a Secret carrying only some
of them works — Questarr falls back to its own generated values for what is missing.

`questarr.existingSecretKeys` only renames the _key_ each value is read from inside the
Secret; the environment variable Questarr sees (`JWT_SECRET`, `IGDB_CLIENT_ID`, …) is
fixed by the application. So a Secret that stores the JWT secret under `release-jwt`
needs `questarr.existingSecretKeys.jwtSecret=release-jwt` and nothing else.

### Storage

| Key                                  | Default           | Description                                             |
| ------------------------------------ | ----------------- | ------------------------------------------------------- |
| `persistence.data.enabled`           | `true`            | Persist `/app/data`; `false` uses an `emptyDir`         |
| `persistence.data.existingClaim`     | `""`              | Use an existing PVC instead of creating one             |
| `persistence.data.storageClass`      | `""`              | `""` = cluster default, `-` = no dynamic provisioning   |
| `persistence.data.accessModes`       | `[ReadWriteOnce]` | PVC access modes                                        |
| `persistence.data.size`              | `2Gi`             | PVC size                                                |
| `persistence.data.retain`            | `false`           | Keep the PVC on `helm uninstall`                        |
| `extraVolumes` / `extraVolumeMounts` | `[]`              | Additional volumes, typically the media/downloads share |

Imports are atomic moves only when Questarr sees your library and completed-downloads
directories at the same paths as your download client. Mount that shared storage with
`extraVolumes` / `extraVolumeMounts`:

```yaml
extraVolumes:
  - name: media
    persistentVolumeClaim:
      claimName: media
extraVolumeMounts:
  - name: media
    mountPath: /data
```

### Networking

| Key                   | Default                 | Description                                |
| --------------------- | ----------------------- | ------------------------------------------ |
| `service.type`        | `ClusterIP`             | Service type                               |
| `service.port`        | `5000`                  | Service port                               |
| `service.nodePort`    | `""`                    | Node port, for `NodePort` / `LoadBalancer` |
| `service.annotations` | `{}`                    | Service annotations                        |
| `service.labels`      | `{}`                    | Extra Service labels                       |
| `ingress.enabled`     | `false`                 | Create an Ingress                          |
| `ingress.className`   | `""`                    | Ingress class                              |
| `ingress.annotations` | `{}`                    | Ingress annotations                        |
| `ingress.hosts`       | `questarr.local` at `/` | Hosts and paths                            |
| `ingress.tls`         | `[]`                    | TLS configuration                          |

Serving from a subdirectory (`https://host/questarr/`) needs `questarr.basePath` set as
well as the Ingress path — Questarr mounts itself under the prefix rather than relying
on the proxy to rewrite it. See [docs/REVERSE_PROXY.md](../../docs/REVERSE_PROXY.md).

```yaml
questarr:
  basePath: /questarr
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: home.example.com
      paths:
        - path: /questarr
          pathType: Prefix
```

Questarr's own HTTPS listener (Settings → SSL) is not exposed by this chart: terminate
TLS at the Ingress instead.

### Scheduling, security and probes

| Key                                                                        | Default                      | Description                              |
| -------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------- |
| `podSecurityContext`                                                       | `fsGroup: 1000`              | Pod-level security context               |
| `securityContext`                                                          | root + narrowed capabilities | Container security context (see below)   |
| `serviceAccount.create`                                                    | `true`                       | Create a ServiceAccount                  |
| `serviceAccount.automountServiceAccountToken`                              | `false`                      | Questarr never calls the Kubernetes API  |
| `resources`                                                                | modest defaults              | Resource requests and limits             |
| `livenessProbe` / `readinessProbe` / `startupProbe`                        | enabled                      | Probe tuning; each has an `enabled` flag |
| `nodeSelector`, `tolerations`, `affinity`                                  | empty                        | Scheduling controls                      |
| `topologySpreadConstraints`, `priorityClassName`, `dnsPolicy`, `dnsConfig` | empty                        | Further pod-spec controls                |

`resources` ships with conservative defaults (256Mi memory / 100m CPU requested, 1Gi
memory and 2Gi ephemeral-storage limits) so the pod is schedulable under a
`LimitRange` or a namespace quota. Raise them if imports of large archives get
OOM-killed, or set `resources: {}` to run without any.

`extraEnv` is rendered before the chart-managed variables, so entries there cannot
override `SQLITE_DB_PATH`, `PORT`, `PUID`/`PGID` or the base path — use the dedicated
values for those.

Liveness and startup probes hit `/api/health`, which stays reachable unprefixed even
when `questarr.basePath` is set; readiness hits `/api/ready` under the base path, which
also checks database connectivity.

The container starts as root on purpose: its entrypoint applies `PUID`/`PGID` to
`/app/data` and then drops privileges with `su-exec` before the app runs. The default
`securityContext` keeps only the capabilities that needs — `CHOWN`, `SETGID` and
`SETUID`, on top of `drop: ALL` and `allowPrivilegeEscalation: false`. `DAC_OVERRIDE`
is deliberately not granted, so a volume whose modes deny root will fail the
entrypoint's writability check with a clear error rather than being forced open. If your cluster forbids root
containers, pre-create the volume with the right ownership and run fully unprivileged:

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

The entrypoint's `groupmod`/`usermod`/`chown` steps then fail unless the volume is
already owned by `1000:1000`, so verify the pod starts before relying on it.

## Upgrading

```bash
helm upgrade questarr charts/questarr --namespace questarr
```

Database migrations run at startup. The `Recreate` strategy stops the old pod before the
new one starts, so expect a short outage during upgrades. Back up `/app/data` first — the
PVC is deleted with the release unless `persistence.data.retain` is `true` or you use
`persistence.data.existingClaim`.

## Testing a release

```bash
helm test questarr --namespace questarr
```

This runs a short-lived pod that requests `/api/health` through the Service.
