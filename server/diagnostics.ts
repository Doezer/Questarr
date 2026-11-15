/**
 * Support diagnostics snapshot.
 *
 * Builds a compact, secret-free description of the instance (runtime, database
 * dialect, indexer/downloader configuration, key feature flags and a digest of
 * recent errors) that is attached to support-log submissions: the manual "Send
 * Logs" flow (`GET /api/diagnostics`) and the automatic error telemetry
 * (`server/error-telemetry.ts`).
 *
 * A raw log tail rarely answers the first questions a maintainer has ("is the
 * API key even set? plain HTTP? which downloader type?"), and the scrubbed logs
 * deliberately hide hosts and keys. This snapshot answers them with *shape*
 * information only: it never contains a hostname, IP address, credential,
 * credential fragment, URL path or query string.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dialect } from "./db.js";
import { storage } from "./storage.js";
import { indexerAllowsApiKey } from "./indexer-caps.js";
import { loadProwlarrSyncSettings } from "./prowlarr-settings.js";
import { scrubPii } from "../shared/log-scrub.js";
import type { Downloader, Indexer, UserSettings } from "../shared/schema.js";

const MAX_ERROR_GROUPS = 15;
const MAX_ERROR_TEXT = 200;

const { version: APP_VERSION } = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

export type HostKind =
  "loopback" | "private-ip" | "public-ip" | "single-label-hostname" | "fqdn" | "invalid";

export interface EndpointShape {
  scheme: string | null;
  hostKind: HostKind;
  port: number | null;
}

export interface SecretShape {
  set: boolean;
  length: number;
  charset: "hex" | "alphanumeric" | "other" | "none";
  /** Leading/trailing whitespace or wrapping quotes: a classic cause of 401s. */
  suspiciousPadding: boolean;
}

export interface IndexerDiagnostics extends EndpointShape {
  name: string;
  protocol: string;
  enabled: boolean;
  priority: number;
  /** Looks like a Prowlarr proxy URL (`/<id>/api`). */
  prowlarrProxyPath: boolean;
  apiKeyShape: SecretShape;
  allowInsecureLan: boolean;
  /** True when the key is withheld from requests (plain HTTP without the opt-in). */
  apiKeyWithheld: boolean;
  /** True when this indexer's key equals the saved Prowlarr sync key. */
  keyMatchesProwlarrKey: boolean | null;
  rssEnabled: boolean;
  autoSearchEnabled: boolean;
  timeoutSeconds: number | null;
  categoryCount: number;
}

export interface DownloaderDiagnostics extends EndpointShape {
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
  useSsl: boolean;
  hasUrlPath: boolean;
  username: boolean;
  passwordShape: SecretShape;
  allowInsecureLan: boolean;
  allowSelfSignedCertificate: boolean;
  category: string | null;
}

export interface ErrorGroup {
  count: number;
  module: string;
  message: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  app: {
    version: string;
    nodeEnv: string | null;
    database: string;
    docker: boolean;
    uptimeSeconds: number;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
    osRelease: string;
    timezone: string;
    cpuCount: number;
    totalMemoryMb: number;
    rssMb: number;
  };
  settings: Record<string, string | number | boolean | null>;
  prowlarr: (EndpointShape & { allowInsecureLan: boolean }) | null;
  indexers: IndexerDiagnostics[];
  downloaders: DownloaderDiagnostics[];
  recentErrors: ErrorGroup[];
}

// ── Shape helpers (exported for tests) ───────────────────────────────────────

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
}

function parseStrict(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function classifyHost(hostname: string): HostKind {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || /^127\./.test(host)) return "loopback";
  const octets = host.split(".");
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) {
    const [a, b] = octets.map(Number) as [number, number];
    const isPrivate =
      a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169;
    return isPrivate ? "private-ip" : "public-ip";
  }
  if (host.includes(":")) {
    return /^(fc|fd|fe80)/.test(host) ? "private-ip" : "public-ip";
  }
  return host.includes(".") ? "fqdn" : "single-label-hostname";
}

/** Describes where a URL points without revealing the host, path or query. */
export function describeEndpoint(
  rawUrl: string,
  explicitPort?: number | null,
  options: { strict?: boolean } = {}
): EndpointShape {
  // Strict mode mirrors the request path (`new URL(url)` on the stored value), so a
  // scheme-less indexer URL shows up as invalid instead of being silently "fixed".
  const parsed = options.strict ? parseStrict(rawUrl) : parseUrl(rawUrl);
  if (!parsed) return { scheme: null, hostKind: "invalid", port: explicitPort ?? null };
  const urlPort = parsed.port ? Number(parsed.port) : null;
  return {
    scheme: parsed.protocol.replace(/:$/, ""),
    hostKind: classifyHost(parsed.hostname),
    port: explicitPort ?? urlPort,
  };
}

/** Describes a credential's shape (never any part of its value). */
export function describeSecret(value: string | null | undefined): SecretShape {
  if (!value) return { set: false, length: 0, charset: "none", suspiciousPadding: false };
  const trimmed = value.trim();
  let charset: SecretShape["charset"] = "other";
  if (/^[0-9a-f]+$/i.test(trimmed)) charset = "hex";
  else if (/^[0-9a-z]+$/i.test(trimmed)) charset = "alphanumeric";
  return {
    set: true,
    length: value.length,
    charset,
    suspiciousPadding: value !== trimmed || /^["'`].*["'`]$/.test(trimmed),
  };
}

function hasProwlarrProxyPath(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl);
  return parsed ? /^\/\d+\/api\/?$/i.test(parsed.pathname) : false;
}

function apiKeyWithheld(indexer: Pick<Indexer, "url" | "apiKey" | "allowInsecureLan">): boolean {
  return Boolean(indexer.apiKey) && !indexerAllowsApiKey(indexer);
}

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * Allowlist of non-sensitive settings that change behaviour. Anything not listed
 * (paths, patterns, group lists, notification targets) is left out on purpose.
 */
const SETTING_KEYS = [
  "autoSearchEnabled",
  "autoDownloadEnabled",
  "autoSearchUnreleased",
  "searchIntervalHours",
  "igdbRateLimitPerSecond",
  "xrelSceneReleases",
  "xrelP2pReleases",
  "upgradePolicy",
  "steamSyncEnabled",
  "steamSyncFailures",
  "steamSyncIntervalHours",
  "filterByPreferredGroups",
  "enablePostProcessing",
  "autoUnpack",
  "transferMode",
  "overwriteExisting",
  "autoDeleteAfterImport",
  "minFileSize",
  "telemetryEnabled",
] as const satisfies readonly (keyof UserSettings)[];

function pickSettings(settings: UserSettings | undefined): DiagnosticsSnapshot["settings"] {
  const picked: DiagnosticsSnapshot["settings"] = {};
  if (!settings) return picked;
  for (const key of SETTING_KEYS) {
    const value = settings[key] as unknown;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      picked[key] = value;
    }
  }
  return picked;
}

// ── Error digest ─────────────────────────────────────────────────────────────

/**
 * Strips what `scrubPii` leaves behind in free text: URL hosts, DNS names after
 * resolver errors, and absolute filesystem paths (it only handles home dirs).
 */
export function scrubFreeText(text: string): string {
  return scrubPii(text)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/"'<>]+/gi, "$1[host]")
    .replace(/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET)\s+\S+/g, "$1 [host]")
    .replace(/(?<![\w.:])\/(?:[\w.-]+\/)+[\w.-]*/g, "[path]")
    .replace(/\b[A-Za-z]:\\[^\s"']+/g, "[path]");
}

/** User-chosen names are kept (they identify the entry) unless they look like a host or path. */
export function sanitizeName(name: string): string {
  const scrubbed = scrubFreeText(name);
  return /^\S+\.[a-z]{2,}(?::\d+)?$/i.test(scrubbed) || /[/\\]/.test(scrubbed)
    ? "[host-like name]"
    : scrubbed;
}

function clip(text: string): string {
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;
}

/**
 * Groups warn/error/fatal NDJSON lines by module and message so a long log
 * collapses into "21x HTTP 401 ..." rather than 21 near-identical lines.
 */
export function summarizeErrors(lines: string[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      entry = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry.level !== "number" || entry.level < 40) continue;

    const module = typeof entry.module === "string" ? entry.module : "unknown";
    const errorField = entry.error;
    const errorMessage =
      typeof errorField === "string"
        ? errorField
        : errorField && typeof errorField === "object" && "message" in errorField
          ? String((errorField as { message: unknown }).message)
          : "";
    const msg = typeof entry.msg === "string" ? entry.msg : "";
    const message = clip(scrubFreeText([msg, errorMessage].filter(Boolean).join(": ")));
    const time = typeof entry.time === "string" ? entry.time : null;

    const key = `${module}|${message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = time ?? existing.lastSeen;
    } else {
      groups.set(key, { count: 1, module, message, firstSeen: time, lastSeen: time });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_ERROR_GROUPS);
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

function toMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function describeIndexer(indexer: Indexer, prowlarrKey: string | null): IndexerDiagnostics {
  return {
    name: sanitizeName(indexer.name),
    protocol: indexer.protocol,
    enabled: indexer.enabled,
    priority: indexer.priority,
    ...describeEndpoint(indexer.url, null, { strict: true }),
    prowlarrProxyPath: hasProwlarrProxyPath(indexer.url),
    apiKeyShape: describeSecret(indexer.apiKey),
    allowInsecureLan: indexer.allowInsecureLan,
    apiKeyWithheld: apiKeyWithheld(indexer),
    keyMatchesProwlarrKey: prowlarrKey && indexer.apiKey ? indexer.apiKey === prowlarrKey : null,
    rssEnabled: indexer.rssEnabled,
    autoSearchEnabled: indexer.autoSearchEnabled,
    timeoutSeconds: indexer.timeoutSeconds ?? null,
    categoryCount: indexer.categories?.length ?? 0,
  };
}

function describeDownloader(downloader: Downloader): DownloaderDiagnostics {
  return {
    name: sanitizeName(downloader.name),
    type: downloader.type,
    enabled: downloader.enabled,
    priority: downloader.priority,
    ...describeEndpoint(downloader.url, downloader.port),
    useSsl: downloader.useSsl === true,
    hasUrlPath: Boolean(downloader.urlPath),
    username: Boolean(downloader.username),
    passwordShape: describeSecret(downloader.password),
    allowInsecureLan: downloader.allowInsecureLan,
    allowSelfSignedCertificate: downloader.allowSelfSignedCertificate,
    category: downloader.category ?? null,
  };
}

export interface BuildDiagnosticsOptions {
  /** Raw NDJSON log lines to digest into `recentErrors`. */
  logLines?: string[];
  /** Whose settings to report; defaults to the first user (Questarr is single tenant). */
  userId?: string;
}

/** Runs one section; a failure becomes an empty section so the rest still ships. */
async function safely<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

export async function buildDiagnosticsSnapshot(
  options: BuildDiagnosticsOptions = {}
): Promise<DiagnosticsSnapshot> {
  const prowlarrSaved = await safely(() => loadProwlarrSyncSettings(), null);
  const [indexers, downloaders, settings] = await Promise.all([
    safely(() => storage.getAllIndexers(), [] as Indexer[]),
    safely(() => storage.getAllDownloaders(), [] as Downloader[]),
    safely(
      async () => {
        const userId = options.userId ?? (await storage.getAllUsers())[0]?.id;
        return userId ? await storage.getUserSettings(userId) : undefined;
      },
      undefined as UserSettings | undefined
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      nodeEnv: process.env.NODE_ENV ?? null,
      database: dialect,
      docker: existsSync("/.dockerenv"),
      uptimeSeconds: Math.round(process.uptime()),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cpuCount: os.cpus().length,
      totalMemoryMb: toMb(os.totalmem()),
      rssMb: toMb(process.memoryUsage().rss),
    },
    settings: pickSettings(settings),
    prowlarr: prowlarrSaved
      ? {
          ...describeEndpoint(prowlarrSaved.url),
          allowInsecureLan: prowlarrSaved.allowInsecureLan,
        }
      : null,
    indexers: indexers.map((indexer) => describeIndexer(indexer, prowlarrSaved?.apiKey ?? null)),
    downloaders: downloaders.map(describeDownloader),
    recentErrors: summarizeErrors(options.logLines ?? []),
  };
}

// Field names above deliberately avoid `apiKey`/`password`/`token`/`secret`:
// the final scrubPii pass would rewrite them as secrets and corrupt the JSON.
export const DIAGNOSTICS_BEGIN =
  "=== QUESTARR DIAGNOSTICS (hosts, addresses, paths and credentials removed) ===";
export const DIAGNOSTICS_END = "=== END DIAGNOSTICS ===";

/** Renders the snapshot as a text block that precedes the logs in a submission. */
export function formatDiagnosticsBlock(snapshot: DiagnosticsSnapshot): string {
  return scrubPii(`${DIAGNOSTICS_BEGIN}\n${JSON.stringify(snapshot, null, 1)}\n${DIAGNOSTICS_END}`);
}
