# Synology Download Station API — undocumented behavior notes

`SYNO.DownloadStation2.Task` (DSM 7, "DS2") and `SYNO.DownloadStation.Task` (legacy, "v1") are
not documented in Synology's public API reference beyond the parameter names. The exact request
shape (HTTP method, multipart field order, value encoding, where `_sid` goes) was reverse-engineered.
This doc records what we tried, what turned out to be wrong, and the contract currently implemented
in `server/downloaders/synology.ts`, so a future debugging session doesn't have to redo the research.

## Current implementation (verified against Prowlarr's live client)

Source: [`DownloadStationTaskProxyV2.cs`](https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Download/Clients/DownloadStation/Proxies/DownloadStationTaskProxyV2.cs),
[`DownloadStationTaskProxyV1.cs`](https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Download/Clients/DownloadStation/Proxies/DownloadStationTaskProxyV1.cs),
[`DiskStationProxyBase.cs`](https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Download/Clients/DownloadStation/Proxies/DiskStationProxyBase.cs)
(fetched 2026-07-02). Prowlarr is a live, widely-deployed \*arr project handling this exact API, so
its shape is trusted over our own guesses — but it has not been tested against a real Synology
device from inside this codebase. If a user reports error 101/120 again, re-check this first.

### Add by URL/magnet — both API versions

Sent as **GET** (not POST) — everything is a query param, so there's no multipart ordering
constraint to worry about:

- DS2: `type=url&url=<url>&create_list=false&destination=<dir>` (destination omitted if blank)
- v1 (legacy): `uri=<url>&destination=<dir>` (destination omitted if blank)

Values are bare strings — no JSON quoting for GET query params.

### Add by file upload (torrent/NZB) — both API versions

Sent as **POST multipart/form-data**. Synology's official (v1) docs state the uploaded file must
be the **last** parameter in the body — our client honors this for both versions via an
`appendFileLast` hook that runs after all other params are appended.

**DS2** (`SYNO.DownloadStation2.Task`):

- `_sid` goes in the **query string**, not the form body (`sidInQuery: true`). This is presumably
  Synology's own workaround for the same "file must be last" constraint — keeping identity out of
  the body entirely.
- Form fields, in order: `api`, `version`, `method`, `type`, `file`, `create_list`, `destination`
  (optional), then the file itself **last**.
- `type`, `file`, and `destination` are sent as **JSON-encoded string literals** — i.e. the raw
  form value for `type` is the 6-character string `"file"` (quotes included), and `file` is the
  literal string `["fileData"]` (brackets and quotes included). This is not a bug in our code; it
  matches Prowlarr's proxy byte-for-byte and is presumed to be a real DS2 API quirk (POST body
  values may be JSON-decoded server-side while GET query values are not).
- The actual file bytes are uploaded under the field name **`fileData`** — not `file`. The `file`
  form field is a separate JSON-array reference pointing at the `fileData` field name, not the
  bytes themselves.
- `create_list` is the bare (unquoted) string `"false"`.

**v1** (`SYNO.DownloadStation.Task`, legacy):

- `_sid` stays in the form body (normal case).
- Form fields, in order: `api`, `version`, `method`, `destination` (optional), then the file
  **last**, under field name `file` (matches the official public docs — no `type`, no
  `create_list`, no JSON quoting).
- Uses API **version 2** for this call specifically (`preferredVersion: 2`, passed as a
  `requestTaskApi` override), even though other legacy calls (list/pause/resume/delete/URL-add)
  use version 3. Prowlarr's proxy does the same version split; the reason isn't documented
  anywhere, just replicated.

### Ordering is not guaranteed to survive a session-timeout retry

`requestApi` retries once on error 106 (session expired) by re-authenticating and re-calling
itself with the same `options` object — including the same `FormData` instance passed in by
`addFileUpload`. Because `appendApiParams`/`appendFileLast` mutate that FormData in place rather
than rebuilding it, a retry re-appends `api`/`version`/`method`/etc. a second time and appends the
file field twice, so it's no longer strictly last. This is a pre-existing pattern (the pre-refactor
code had the same same-object retry behavior), and a 106 landing mid-upload is rare, but it does mean the
"file must be last" guarantee only holds on the first attempt. Rebuilding the FormData from scratch
on retry would close this if it turns out to matter in practice.

## Superseded approaches (kept for fallback reference)

If the contract above turns out not to work for a given device/DSM version, here is what was tried
before and rejected, in case reverting to a simpler shape is worth testing:

### Phase 1 (root-caused from a live error-120 report, applied first)

For `createUrlDownload`, both API versions unified on:

```
POST .../entry.cgi (or task.cgi)
DS2:    type=url, uri=<url>, destination=<dir>
legacy: uri=<url>, destination=<dir>
```

This fixed the original bug (`url` field name + `JSON.stringify([url])` value + a stray
`create_list` field that DS2 rejected as error 120), but used **`uri`** as the DS2 field name and
**POST**. Prowlarr's proxy uses **`url`** (not `uri`) for DS2 and sends it as a **GET**, with
`create_list=false` explicitly included. If the current GET-based fix regresses on some devices,
this POST/`uri` variant is the next thing to try — it's simpler and was confirmed to fix the
originally reported error 120, just not verified against the DS2 file-upload path.

### Phase 2 original spec (literal field order, not adopted for DS2)

The initial ask was to reorder `addFileUpload` so all API params are appended before a single
`file` field, appended last, with the DS2 `type` value corrected from `bt`/`nzb` — but keeping the
field named `file` throughout and `_sid` in the form body for both API versions. This is
plausible for **v1** (and is what's implemented above), but Prowlarr's evidence suggests DS2
specifically needs the `fileData`-plus-JSON-array-reference structure and query-string `_sid`
described above, not just a reordered `file` field with a corrected `type` value. If the current
DS2 upload path fails, trying `type: "file"` with the bytes still under `file` (no `fileData`
split, no query `_sid`) would be the intermediate step to test before reverting further.
