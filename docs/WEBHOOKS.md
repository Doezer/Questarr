# Outbound webhooks

Questarr can POST a signed JSON event to your own automation (n8n, Home Assistant, a script) when something happens. Manage them in **Settings → Notifications → Outbound Webhooks**, or through the API (see [API](API.md#outbound-webhooks)) with a JWT session or an `admin`-scope API key.

This is separate from [Apprise](../README.md) push notifications and from the Discord share on the Statistics page.

## Events

| Event                | Sent when                                                                                             | `data`                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `download.completed` | A download finished in the download client                                                            | `gameId`, `gameTitle`, `downloadId`, `downloadTitle`           |
| `download.failed`    | A download was aborted, or disappeared from the client before completing                              | `gameId`, `gameTitle`, `downloadId`, `downloadTitle`, `reason` |
| `import.failed`      | An import could not finish: the files were not reachable (path mappings) or archive extraction failed | `gameId`/`downloadId`, `gameTitle`, `reason`                   |
| `game.released`      | The daily game update saw a game switch to released                                                   | `gameId`, `gameTitle`, `releaseDate`                           |
| `game.delayed`       | The daily game update saw a release date slip past the delay threshold                                | `gameId`, `gameTitle`, `releaseDate`                           |

Webhooks are independent of the in-app and Apprise notification switches: a subscription receives its events even if you turned those notifications off. Events for a game go to the webhooks of the user who owns that game.

`webhook.test` is only sent by **Send test** (`POST /api/webhooks/:id/test`).

## Request

```
POST <your url>
Content-Type: application/json
User-Agent: Questarr-Webhooks
X-Questarr-Event: download.completed
X-Questarr-Delivery: 6f1c…        # event id, the same on every retry
X-Questarr-Timestamp: 1763128702  # unix seconds
X-Questarr-Signature: sha256=<hex>
```

```json
{
  "id": "6f1c…",
  "type": "download.completed",
  "createdAt": "2026-11-14T13:58:22.000Z",
  "data": { "gameId": "…", "gameTitle": "Hades", "downloadId": "…", "downloadTitle": "…" }
}
```

## Verifying the signature

The signature is the hex HMAC-SHA256 of `<X-Questarr-Timestamp>.<raw request body>` keyed with the webhook secret. Compute it over the raw bytes you received, compare in constant time, and reject a timestamp that is too old (for example more than five minutes) to stop replays.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, timestamp, rawBody, header) {
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

The secret is generated when you create the webhook (or sent by you, at least 16 characters) and shown **once**; it is stored encrypted and never returned by the API again. Rotate it with `PATCH /api/webhooks/:id` and `{ "rotateSecret": true }`.

## Delivery

- A delivery succeeds on any `2xx` answer within 10 seconds. Redirects are not followed.
- Network errors, timeouts, `408`, `429` and `5xx` are retried: up to 3 attempts, after 2 s and 10 s. Other `4xx` answers are final.
- The target URL must be `http(s)` without embedded credentials. Requests go through Questarr's SSRF-protected fetch: cloud metadata and link-local addresses are refused, private networks (your LAN) are allowed because that is where self-hosted automation usually lives. Use HTTPS when the receiver is not on your own network.
- The last 50 attempts of each webhook (time, event, HTTP status or error, attempt number) are shown under **Recent deliveries** and at `GET /api/webhooks/:id/deliveries`. The **Webhook delivery log** System Task trims anything older, hourly.
- Up to 20 webhooks per user. Deleting a webhook deletes its delivery log.
