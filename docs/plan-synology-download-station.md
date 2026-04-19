# Plan: Add Synology Download Station Support (Issue #567)

## Context

A user requested Synology Download Station as a download client (like Sonarr/Radarr support it). Questarr already supports 5 clients (qBittorrent, Transmission, rTorrent, SABnzbd, NZBGet) via a clean factory pattern. No schema changes are needed — existing fields cover all Synology config. The Synology Web API uses session-based auth and has a DSM 6 vs DSM 7 split (different CGI paths/API names).

---

## Files to Modify

| File                                   | Change                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| `server/downloaders.ts`                | Add `SynologyDownloadStationClient` class + factory case |
| `client/src/pages/downloaders.tsx`     | Add to type picker + default port                        |
| `server/__tests__/downloaders.test.ts` | Add test suite for Synology client                       |

No migrations needed.

---

## Implementation Plan

### 1. `server/downloaders.ts` — New Client Class

Add `SynologyDownloadStationClient implements DownloaderClient` near line 3250 (after NZBGet).

**Auth strategy:**

- On first request, call `GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth,SYNO.DownloadStation2.Task` to detect DSM version
- Cache the session ID (`_sid`) in-memory; re-login on error code 106 (session timeout), retry once
- Build base URL from `downloader.url`, `downloader.port`, `downloader.useSsl`

**API dual-path:**

- DSM 6: `POST /webapi/DownloadStation/task.cgi` with `SYNO.DownloadStation.Task` v2
- DSM 7: `POST /webapi/DownloadStation/entry.cgi` with `SYNO.DownloadStation2.Task` v2 + `create_list=false`
- Detection: presence of `SYNO.DownloadStation2.Task` in `SYNO.API.Info` response

**Method implementations:**

| Method                            | Synology API call                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `testConnection()`                | Login + logout                                                                                                |
| `addDownload(request)`            | URL/magnet: `uri=` (DSM6) or `url=`+`type=url`+`create_list=false` (DSM7); torrent/NZB file: multipart upload |
| `getDownloadStatus(id)`           | `method=getinfo&id=<id>&additional=detail,transfer`                                                           |
| `getDownloadDetails(id)`          | `method=getinfo&id=<id>&additional=detail,transfer,file,tracker`                                              |
| `getAllDownloads()`               | `method=list&additional=detail,transfer`                                                                      |
| `pauseDownload(id)`               | `method=pause&id=<id>`                                                                                        |
| `resumeDownload(id)`              | `method=resume&id=<id>`                                                                                       |
| `removeDownload(id, deleteFiles)` | `method=delete&id=<id>&force_complete=false`                                                                  |
| `getFreeSpace()`                  | `SYNO.FileStation.Info&method=get` → `useable_space` field                                                    |

**Status mapping** (Synology → internal):

```typescript
const STATUS_MAP = {
  waiting: "queued",
  downloading: "downloading",
  paused: "paused",
  finishing: "downloading",
  finished: "completed",
  hash_checking: "checking",
  seeding: "seeding",
  extracting: "downloading",
  error: "error",
  filehosting_waiting: "queued",
};
```

**Destination:** use `downloader.downloadPath` if set (Synology expects shared-folder-relative path, e.g. `video/downloads`, not `/volume1/video/downloads`).

**SSRF:** wrap all fetch calls with `isSafeUrl()` (same pattern as other clients, e.g. line 308 of `downloaders.ts`).

### 2. Factory (downloaders.ts ~line 3001)

```typescript
case "synology":
  return new SynologyDownloadStationClient(downloader);
```

### 3. Frontend (client/src/pages/downloaders.tsx ~line 41)

```typescript
{ value: "synology", label: "Synology Download Station", protocol: "torrent" },
```

- Add default port `5000` for Synology in the port defaults map
- No additional custom fields needed — existing fields (name, URL, port, SSL, username, password, download path, category, priority) are sufficient
- Add help text noting DSM 7 uses HTTPS by default

### 4. Tests (server/**tests**/downloaders.test.ts)

Follow Transmission test pattern (lines 25–195). Mock global `fetch`. Cover:

- `testConnection()` — success, auth failure (code 400), network error
- `addDownload()` — magnet (DSM6 path), torrent file upload, DSM7 path detection
- `getDownloadStatus()` — found, not found
- `getAllDownloads()` — status mapping
- `pauseDownload()` / `resumeDownload()` / `removeDownload()`
- Session timeout (error 106) → re-login + retry once
- `getFreeSpace()`

---

## Synology API Reference

**Base URL:** `http(s)://<host>:<port>/webapi/` (default ports: 5000 HTTP, 5001 HTTPS)

**Auth:**

```
GET /webapi/auth.cgi?api=SYNO.API.Auth&version=3&method=login
  &account=<user>&passwd=<pass>&session=DownloadStation&format=sid
```

Returns `{ "success": true, "data": { "sid": "..." } }`. Pass `_sid=<sid>` on all subsequent calls.

**Version detection:**

```
GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query
  &query=SYNO.API.Auth,SYNO.DownloadStation2.Task
```

**Task list:**

```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task
  &version=1&method=list&additional=detail,transfer&_sid=<sid>
```

**Add by URL (DSM 6):**

```
POST /webapi/DownloadStation/task.cgi
api=SYNO.DownloadStation.Task&version=1&method=create&uri=<url_or_magnet>&_sid=<sid>
```

**Add by URL (DSM 7):**

```
POST /webapi/DownloadStation/entry.cgi
api=SYNO.DownloadStation2.Task&version=2&method=create&type=url&url=<url>&create_list=false&_sid=<sid>
```

Note: `create_list=false` is **required** on DSM 7 — omitting causes error 101.

**Pause / Resume / Delete:**

```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task
  &version=1&method=pause|resume|delete&id=<task_id>&_sid=<sid>
```

**Key error codes:**

- 106 = session timeout → re-login and retry
- 400 = wrong credentials
- 401 = max tasks reached
- 402/403 = destination denied/not found

---

## Verification

1. `npm run check` — TypeScript compiles cleanly
2. `npx vitest run server/__tests__/downloaders.test.ts` — new Synology tests pass
3. `npm run lint` — no lint errors
4. Manual: configure Synology DS in UI, click "Test Connection"
