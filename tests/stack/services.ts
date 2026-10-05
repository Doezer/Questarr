/**
 * Real download clients and a fake indexer for the real-stack journey (real-stack.spec.ts).
 *
 * qBittorrent, Transmission and SABnzbd run as the real daemons (installed from the
 * distribution packages, see .github/workflows/stack.yml), each with its own profile under
 * STACK_DIR. Nothing leaves the machine: DHT, LSD, PeX and port forwarding are off, and the
 * torrents' payloads are written into each client's download folder before the grab, so the
 * client's own hash check finds them complete without a single peer.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export const STACK_DIR = process.env.STACK_DIR ?? path.join(os.tmpdir(), "questarr-stack");
export const LIBRARY_ROOT = path.join(STACK_DIR, "library");
export const QUESTARR_PORT = 5300;

export const INDEXER = { port: 9117, apiKey: "stack-indexer-key" };
export const QBITTORRENT = {
  port: 8181,
  username: "questarr",
  password: "stack-qbit-pass",
  downloads: path.join(STACK_DIR, "qbittorrent-downloads"),
};
export const TRANSMISSION = {
  port: 9091,
  username: "questarr",
  password: "stack-transmission-pass",
  downloads: path.join(STACK_DIR, "transmission-downloads"),
};
export const SABNZBD = {
  port: 8282,
  apiKey: "0123456789abcdef0123456789abcdef",
  downloads: path.join(STACK_DIR, "sabnzbd-downloads"),
};

/** One release per client, each for its own game, so every journey is independent. */
export const RELEASES = {
  qbittorrent: {
    game: "Stack Smoke Alpha",
    title: "Stack.Smoke.Alpha.v1.0-QSTR",
    protocol: "torrent",
    downloads: QBITTORRENT.downloads,
  },
  transmission: {
    game: "Stack Smoke Bravo",
    title: "Stack.Smoke.Bravo.v1.0-QSTR",
    protocol: "torrent",
    // Transmission has no categories, so Questarr saves into a "<category>" subfolder.
    downloads: path.join(TRANSMISSION.downloads, "games"),
  },
  sabnzbd: {
    game: "Stack Smoke Charlie",
    title: "Stack.Smoke.Charlie.v1.0-QSTR",
    protocol: "usenet",
    downloads: SABNZBD.downloads,
  },
} as const;

export type ReleaseKey = keyof typeof RELEASES;

/** Name of the main file in every payload; the journey looks for it in the library. */
export const PAYLOAD_FILE = "setup.bin";

const PAYLOAD_SIZE = 256 * 1024;
const PIECE_LENGTH = 32 * 1024;

type Bencodable = number | string | Buffer | Bencodable[] | { [key: string]: Bencodable };

function bencode(value: Bencodable): Buffer {
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
  }
  const keys = Object.keys(value).sort();
  return Buffer.concat([
    Buffer.from("d"),
    ...keys.flatMap((key) => [bencode(key), bencode(value[key] as Bencodable)]),
    Buffer.from("e"),
  ]);
}

interface PayloadFile {
  name: string;
  data: Buffer;
}

function payloadFiles(title: string): PayloadFile[] {
  return [
    { name: PAYLOAD_FILE, data: randomBytes(PAYLOAD_SIZE) },
    { name: "release.nfo", data: Buffer.from(`${title}\nQuestarr real-stack fixture\n`) },
  ];
}

/** Multi-file .torrent for a payload folder, with every piece hashed from the real bytes. */
function buildTorrent(title: string, files: PayloadFile[]): Buffer {
  const all = Buffer.concat(files.map((f) => f.data));
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < all.length; offset += PIECE_LENGTH) {
    pieces.push(
      createHash("sha1")
        .update(all.subarray(offset, offset + PIECE_LENGTH))
        .digest()
    );
  }
  return bencode({
    announce: `http://127.0.0.1:${INDEXER.port}/announce`,
    "created by": "Questarr real-stack fixture",
    info: {
      files: files.map((f) => ({ length: f.data.length, path: [f.name] })),
      name: title,
      "piece length": PIECE_LENGTH,
      pieces: Buffer.concat(pieces),
      private: 1,
    },
  });
}

/** A syntactically valid NZB; no news server is configured, so SABnzbd only queues it. */
function buildNzb(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head><meta type="name">${title}</meta></head>
  <file poster="fixture@questarr.invalid" date="1700000000" subject="${title} - &quot;${PAYLOAD_FILE}&quot; yEnc (1/1)">
    <groups><group>alt.binaries.questarr.fixture</group></groups>
    <segments><segment bytes="${PAYLOAD_SIZE}" number="1">fixture-${title}@questarr.invalid</segment></segments>
  </file>
</nzb>
`;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Torznab/Newznab-compatible indexer: `?t=caps` and `?t=search&q=` on any path. */
function startFakeIndexer(torrents: Map<string, Buffer>, nzbs: Map<string, string>): http.Server {
  const base = `http://127.0.0.1:${INDEXER.port}`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    const download = /^\/download\/([^/]+)\.(torrent|nzb)$/.exec(url.pathname);
    if (download) {
      const [, title = "", ext] = download;
      const body = ext === "torrent" ? torrents.get(title) : nzbs.get(title);
      if (!body) return void res.writeHead(404).end();
      res.writeHead(200, {
        "Content-Type": ext === "torrent" ? "application/x-bittorrent" : "application/x-nzb",
        "Content-Disposition": `attachment; filename="${title}.${ext}"`,
      });
      return void res.end(body);
    }

    const usenet = url.pathname.startsWith("/newznab");
    if (url.searchParams.get("apikey") !== INDEXER.apiKey) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return void res.end('<error code="100" description="Incorrect user credentials"/>');
    }
    const t = url.searchParams.get("t");
    res.writeHead(200, { "Content-Type": "application/xml" });
    if (t === "caps") {
      return void res.end(`<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Questarr stack ${usenet ? "Newznab" : "Torznab"}"/>
  <limits max="100" default="50"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="no"/>
    <movie-search available="no"/>
  </searching>
  <categories>
    <category id="4000" name="PC"><subcat id="4050" name="PC/Games"/></category>
  </categories>
</caps>`);
    }

    const words = (url.searchParams.get("q") ?? "")
      .toLowerCase()
      .split(/[\s._-]+/)
      .filter(Boolean);
    const ns = usenet ? "newznab" : "torznab";
    const items = Object.values(RELEASES)
      .filter((r) => (r.protocol === "usenet") === usenet)
      .filter((r) => words.every((w) => r.title.toLowerCase().includes(w)))
      .map((r) => {
        const ext = usenet ? "nzb" : "torrent";
        const link = `${base}/download/${r.title}.${ext}`;
        const size = PAYLOAD_SIZE;
        const attrs = usenet
          ? `<newznab:attr name="category" value="4050"/><newznab:attr name="grabs" value="42"/>`
          : `<torznab:attr name="category" value="4050"/><torznab:attr name="seeders" value="25"/><torznab:attr name="peers" value="30"/>`;
        return `<item>
  <title>${xmlEscape(r.title)}</title>
  <guid>${xmlEscape(link)}</guid>
  <link>${xmlEscape(link)}</link>
  <pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate>
  <size>${size}</size>
  <category>4050</category>
  <enclosure url="${xmlEscape(link)}" length="${size}" type="application/x-${usenet ? "nzb" : "bittorrent"}"/>
  ${attrs}
</item>`;
      });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:${ns}="http://${ns}.com/schemas/2015/feed">
<channel><title>Questarr stack indexer</title>
${items.join("\n")}
</channel></rss>`);
  });
  server.listen(INDEXER.port, "127.0.0.1");
  return server;
}

/** qBittorrent 4.2+ stores the WebUI password as PBKDF2-HMAC-SHA512, 100k rounds. */
function qbittorrentPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 100_000, 64, "sha512");
  return `@ByteArray(${salt.toString("base64")}:${key.toString("base64")})`;
}

function writeClientConfigs(): void {
  const qbConfig = path.join(STACK_DIR, "qbittorrent", "qBittorrent", "config");
  mkdirSync(qbConfig, { recursive: true });
  writeFileSync(
    path.join(qbConfig, "qBittorrent.conf"),
    `[LegalNotice]
Accepted=true

[BitTorrent]
Session\\DefaultSavePath=${QBITTORRENT.downloads}
Session\\DHTEnabled=false
Session\\LSDEnabled=false
Session\\PeXEnabled=false
Session\\Port=51413
Session\\QueueingSystemEnabled=false

[Preferences]
Connection\\UPnP=false
WebUI\\Address=127.0.0.1
WebUI\\Port=${QBITTORRENT.port}
WebUI\\Username=${QBITTORRENT.username}
WebUI\\Password_PBKDF2="${qbittorrentPasswordHash(QBITTORRENT.password)}"
WebUI\\LocalHostAuth=true
WebUI\\CSRFProtection=false
WebUI\\HostHeaderValidation=false
`
  );

  const trConfig = path.join(STACK_DIR, "transmission");
  mkdirSync(trConfig, { recursive: true });
  writeFileSync(
    path.join(trConfig, "settings.json"),
    JSON.stringify(
      {
        "download-dir": TRANSMISSION.downloads,
        "incomplete-dir-enabled": false,
        "dht-enabled": false,
        "lpd-enabled": false,
        "pex-enabled": false,
        "utp-enabled": false,
        "port-forwarding-enabled": false,
        "peer-port": 51414,
        "rpc-bind-address": "127.0.0.1",
        "rpc-port": TRANSMISSION.port,
        "rpc-authentication-required": true,
        "rpc-username": TRANSMISSION.username,
        "rpc-password": TRANSMISSION.password,
        "rpc-whitelist-enabled": false,
        "rpc-host-whitelist-enabled": false,
      },
      null,
      2
    )
  );

  const sabDir = path.join(STACK_DIR, "sabnzbd");
  mkdirSync(sabDir, { recursive: true });
  writeFileSync(
    path.join(sabDir, "sabnzbd.ini"),
    `__version__ = 19
[misc]
api_key = ${SABNZBD.apiKey}
nzb_key = ${SABNZBD.apiKey.split("").reverse().join("")}
host = 127.0.0.1
port = ${SABNZBD.port}
download_dir = ${path.join(SABNZBD.downloads, "incomplete")}
complete_dir = ${SABNZBD.downloads}
host_whitelist = 127.0.0.1, localhost
local_ranges = 127.0.0.1,
check_new_rel = 0
auto_browser = 0
enable_https = 0
[categories]
[[*]]
name = *
dir = ""
[[games]]
name = games
dir = games
`
  );
}

function spawnLogged(name: string, command: string, args: string[]): ChildProcess {
  const log = createWriteStream(path.join(STACK_DIR, `${name}.log`));
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

async function waitFor(name: string, url: string, init?: RequestInit): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not come up at ${url}: ${lastError}`);
}

/**
 * Writes the payloads, the client profiles and the indexer's catalogue, then starts every
 * service. Resolves once each one answers; the returned function stops them all.
 */
export async function startServices(): Promise<() => Promise<void>> {
  rmSync(STACK_DIR, { recursive: true, force: true });
  for (const dir of [
    LIBRARY_ROOT,
    QBITTORRENT.downloads,
    TRANSMISSION.downloads,
    SABNZBD.downloads,
  ])
    mkdirSync(dir, { recursive: true });

  const torrents = new Map<string, Buffer>();
  const nzbs = new Map<string, string>();
  for (const release of Object.values(RELEASES)) {
    if (release.protocol === "usenet") {
      nzbs.set(release.title, buildNzb(release.title));
      continue;
    }
    const files = payloadFiles(release.title);
    const folder = path.join(release.downloads, release.title);
    mkdirSync(folder, { recursive: true });
    for (const file of files) writeFileSync(path.join(folder, file.name), file.data);
    torrents.set(release.title, buildTorrent(release.title, files));
  }

  writeClientConfigs();
  const indexer = startFakeIndexer(torrents, nzbs);
  const children = [
    spawnLogged("qbittorrent", "qbittorrent-nox", [
      `--profile=${path.join(STACK_DIR, "qbittorrent")}`,
      `--webui-port=${QBITTORRENT.port}`,
    ]),
    spawnLogged("transmission", "transmission-daemon", [
      "--foreground",
      "--config-dir",
      path.join(STACK_DIR, "transmission"),
    ]),
    // SABNZBD_PYTHON runs the packaged script with a specific interpreter, for hosts where
    // /usr/bin/python3 is not the one the distribution's python3-* modules were built for.
    spawnLogged("sabnzbd", process.env.SABNZBD_PYTHON ?? "sabnzbdplus", [
      ...(process.env.SABNZBD_PYTHON ? ["/usr/bin/sabnzbdplus"] : []),
      "--config-file",
      path.join(STACK_DIR, "sabnzbd", "sabnzbd.ini"),
      "--server",
      `127.0.0.1:${SABNZBD.port}`,
      "--browser",
      "0",
    ]),
  ];

  const stop = async () => {
    for (const child of children) child.kill("SIGTERM");
    await new Promise<void>((resolve) => indexer.close(() => resolve()));
  };

  try {
    await waitFor("Fake indexer", `http://127.0.0.1:${INDEXER.port}/api?t=caps`);
    await waitFor("qBittorrent", `http://127.0.0.1:${QBITTORRENT.port}/api/v2/app/version`);
    await waitFor("Transmission", `http://127.0.0.1:${TRANSMISSION.port}/transmission/rpc`);
    await waitFor(
      "SABnzbd",
      `http://127.0.0.1:${SABNZBD.port}/api?mode=version&output=json&apikey=${SABNZBD.apiKey}`
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
