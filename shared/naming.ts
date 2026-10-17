import { parseReleaseMetadata } from "./title-utils.js";

/**
 * Naming templates for imported games ("{Title} ({Year})").
 *
 * The template names the leaf of the library path (a folder, or the file of a single-file
 * release); the platform folder stays outside it. Pure and dependency-free so the server
 * (import planning) and the client (live preview) render exactly the same names.
 *
 * Design inspired by Mikurunazume/Gamearr (shared/naming-engine.ts, GPL-3.0), rewritten for
 * Questarr: illegal characters are replaced by "_" like before, the length cap counts UTF-8
 * bytes, and unknown tokens are rejected instead of leaking into the path.
 */

export const NAMING_TOKENS = [
  "Title",
  "TitleThe",
  "Year",
  "Platform",
  "Version",
  "Group",
  "Source",
  "IgdbId",
  "SteamAppId",
  "Region",
] as const;

export type NamingToken = (typeof NAMING_TOKENS)[number];

export const NAMING_TOKEN_HELP: Record<NamingToken, string> = {
  Title: "Game title",
  TitleThe: 'Title with a leading "The" moved to the end',
  Year: "Release year",
  Platform: "Platform name, as used for the platform folder",
  Version: "Version parsed from the release name",
  Group: "Release group parsed from the release name",
  Source: "Store or DRM parsed from the release name (GOG, Steam, ...)",
  IgdbId: "IGDB id of the game",
  SteamAppId: "Steam App ID of the game",
  Region: "Always empty for now (reserved)",
};

export const DEFAULT_NAMING_PATTERN = "{Title} ({Region})";

export const MAX_NAME_BYTES = 200;

export interface NamingContext {
  title: string;
  year?: string | number | null;
  platform?: string | null;
  version?: string | null;
  group?: string | null;
  source?: string | null;
  igdbId?: number | null;
  steamAppId?: number | null;
}

export interface PatternValidation {
  ok: boolean;
  errors: string[];
  tokens: string[];
}

const TOKEN_LOOKUP = new Map<string, NamingToken>(NAMING_TOKENS.map((t) => [t.toLowerCase(), t]));
const EMPTY = "";
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function validatePattern(pattern: string): PatternValidation {
  const errors: string[] = [];
  const tokens: string[] = [];
  if (!pattern.trim()) errors.push("The pattern is empty");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(pattern)) errors.push("Control characters are not allowed");
  if (/[/\\]/.test(pattern)) errors.push("Slashes are not allowed: the pattern names one folder");
  if (pattern.includes("..")) errors.push('".." is not allowed');

  let depth = 0;
  let balanced = true;
  for (const ch of pattern) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0 || depth > 1) balanced = false;
  }
  if (depth !== 0 || !balanced) errors.push("Unbalanced braces");

  for (const match of pattern.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1] ?? "";
    tokens.push(name);
    if (!TOKEN_LOOKUP.has(name.toLowerCase())) errors.push(`Unknown token {${name}}`);
  }
  return { ok: errors.length === 0, errors, tokens };
}

/** Replaces what a file system refuses with "_" (same rule as the historical sanitizeFsName). */
function sanitizeValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function truncateBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  const segments: string[] =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
          (s) => s.segment
        )
      : Array.from(value);
  let out = "";
  let size = 0;
  for (const segment of segments) {
    const bytes = encoder.encode(segment).length;
    if (size + bytes > maxBytes) break;
    out += segment;
    size += bytes;
  }
  return out;
}

function titleThe(title: string): string {
  const match = /^the\s+(.+)$/i.exec(title.trim());
  return match?.[1] ? `${match[1]}, The` : title;
}

function yearOf(year: NamingContext["year"]): string {
  if (year === null || year === undefined) return "";
  const match = /\d{4}/.exec(String(year));
  return match ? match[0] : "";
}

function tokenValue(token: NamingToken, ctx: NamingContext): string {
  switch (token) {
    case "Title":
      return ctx.title;
    case "TitleThe":
      return titleThe(ctx.title);
    case "Year":
      return yearOf(ctx.year);
    case "Platform":
      return ctx.platform ?? "";
    case "Version":
      return ctx.version ?? "";
    case "Group":
      return ctx.group ?? "";
    case "Source":
      return ctx.source ?? "";
    case "IgdbId":
      return ctx.igdbId ? String(ctx.igdbId) : "";
    case "SteamAppId":
      return ctx.steamAppId ? String(ctx.steamAppId) : "";
    case "Region":
      return "";
  }
}

/**
 * Renders a pattern to a single path segment. Returns "" when nothing usable remains; callers
 * fall back to the sanitized game title. Never throws, and the result never contains a path
 * separator, so it cannot leave its parent folder.
 */
export function renderName(pattern: string, ctx: NamingContext): string {
  // Literal characters of the pattern need the same sanitizing as token values ("{Title}: {Year}").
  let out = sanitizeValue(pattern).replace(/\{([^{}]*)\}/g, (whole, name: string) => {
    const token = TOKEN_LOOKUP.get(name.toLowerCase());
    if (!token) return whole;
    const value = sanitizeValue(tokenValue(token, ctx)).trim();
    return value === "" ? EMPTY : value;
  });

  // Brackets that only held empty tokens, with the whitespace before them.
  const emptyPair = new RegExp(`\\s*[(\\[{][\\s\\-_.,:]*(?:${EMPTY}[\\s\\-_.,:]*)*[)\\]}]`, "g");
  out = out.replace(emptyPair, (m) => (m.includes(EMPTY) ? "" : m));
  // Orphan separators around an empty token at either end ("Title - {Group}").
  out = out
    .replace(new RegExp(`[\\s\\-_.:,]*${EMPTY}+$`), "")
    .replace(new RegExp(`^${EMPTY}+[\\s\\-_.:,]*`), "");
  // An empty token in the middle collapses the whitespace around it.
  out = out.replace(new RegExp(`(\\s*)${EMPTY}+(\\s*)`, "g"), (_m, a: string, b: string) =>
    a || b ? " " : ""
  );

  return finalizeName(out);
}

/** Last normalization shared by rendered and fallback names: length, trailing dots, reserved names. */
function finalizeName(name: string): string {
  let out = name.trim().replace(/[. ]+$/, "");
  out = truncateBytes(out, MAX_NAME_BYTES).replace(/[. ]+$/, "");
  if (out === "" || out === "." || out === "..") return "";
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  return out;
}

/** Name for a game whose pattern renders to nothing (or is unusable). */
export function fallbackName(ctx: NamingContext): string {
  return finalizeName(sanitizeValue(ctx.title)) || "Unknown";
}

export function renderNameOrFallback(pattern: string, ctx: NamingContext): string {
  if (!validatePattern(pattern).ok) return fallbackName(ctx);
  return renderName(pattern, ctx) || fallbackName(ctx);
}

/**
 * Builds the rendering context from a game and the release it was downloaded as. Release
 * tokens (Version, Group, Source) come from the indexer-controlled release name, so they go
 * through the same sanitizing as every other token.
 */
export function buildNamingContext(
  game: {
    title: string;
    releaseDate?: string | null;
    igdbId?: number | null;
    steamAppId?: number | null;
  },
  platformDir?: string | null,
  downloadTitle?: string | null
): NamingContext {
  const meta = downloadTitle ? parseReleaseMetadata(downloadTitle) : undefined;
  return {
    title: game.title,
    year: game.releaseDate ?? null,
    platform: platformDir ?? null,
    version: meta?.version ?? null,
    group: meta?.group ?? null,
    source: meta?.drm ?? null,
    igdbId: game.igdbId ?? null,
    steamAppId: game.steamAppId ?? null,
  };
}
