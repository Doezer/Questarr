# Compatibility

This document lists the current compatibility targets for downloaders supported by Questarr.

## Version info

| Downloader                | Version info                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synology Download Station | Supports `SYNO.DownloadStation.Task` v1 and `SYNO.DownloadStation2.Task` v2 when exposed by the NAS.                                                      |
| Transmission              | Supports the classic Transmission RPC family over the session-based HTTP RPC endpoint.                                                                    |
| qBittorrent               | Supports qBittorrent WebUI API integrations, with modern support aligned to the 4.1+ API family.                                                          |
| SABnzbd                   | Supports the current SABnzbd HTTP API, including the `addurl` and multipart `addfile` flows used by Questarr; modern releases such as 5.0.4 are in scope. |
| NZBGet                    | Supports the NZBGet RPC API used by Questarr, including `append`; the official API documentation covers NZBGet version 13.0 and later.                    |

## Details

### Synology Download Station

Questarr should work with both the legacy and modern Synology task APIs by querying `SYNO.API.Info` and using the best available task endpoint reported by the NAS.

The legacy API is documented in Synology's official Download Station API guide, while the newer `SYNO.DownloadStation2.Task` v2 API has been observed on DSM 7 era systems such as DSM 7.2.1 with Download Station 4.0.1.

### Transmission

Questarr uses the long-lived Transmission RPC interface rather than targeting one exact Transmission release. Transmission 4.1.0 introduced JSON-RPC 2.0 support and snake_case RPC strings, so newer protocol changes should be checked before making stricter version claims.

### qBittorrent

Questarr targets the qBittorrent WebUI API. Historical documentation exists for qBittorrent 3.2.0 through 4.0.4, while the maintained OpenAPI documentation covers the newer 4.1+ API family.

### SABnzbd

Questarr supports SABnzbd through its HTTP API. The current API supports both `addurl` and multipart `addfile` flows, and modern releases such as 5.0.4 are in scope for this integration.

### NZBGet

Questarr supports NZBGet through its RPC API, including the `append` method used to add NZB files, archives, or URLs to the queue.

The official NZBGet API documentation states that it covers version 13.0 and later.
