import http from "node:http";
import { appendFileSync } from "node:fs";

/** Forward to the real daemon while emulating an old client's ignored tag filter. */
export function startLegacyQbittorrentProxy(
  upstreamPort: number,
  proxyPort: number,
  tagLookupLog: string
): http.Server {
  const server = http.createServer((req, res) => {
    const target = new URL(req.url ?? "/", `http://127.0.0.1:${upstreamPort}`);
    const ignoresTag =
      target.pathname === "/api/v2/torrents/info" && target.searchParams.has("tag");
    if (ignoresTag) {
      appendFileSync(tagLookupLog, `${target.searchParams.get("tag")}\n`);
      target.searchParams.delete("tag");
    }
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: { ...req.headers, "accept-encoding": "identity" },
      },
      (response) => {
        if (!ignoresTag || response.statusCode !== 200) {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          // An unrelated torrent appears first. Selecting it would track/import the wrong job.
          const torrents: unknown[] = JSON.parse(Buffer.concat(chunks).toString());
          const body = JSON.stringify([
            {
              hash: "0000000000000000000000000000000000000000",
              name: "Unrelated torrent",
              tags: "",
            },
            ...torrents,
          ]);
          const headers = { ...response.headers, "content-length": Buffer.byteLength(body) };
          delete headers["transfer-encoding"];
          res.writeHead(200, headers);
          res.end(body);
        });
      }
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.listen(proxyPort, "127.0.0.1");
  return server;
}
