import console from "node:console";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";

const STATUSES = ["wanted", "owned", "playing", "completed", "shelved"];
const HELP = `Questarr backlog roulette — let fate choose tonight's game.

Usage: node scripts/backlog-roulette.mjs [options]

  --file <path>       Read a saved integration-library response or game array
  --status <status>   Choose a library status (default: owned)
  --genre <name>      Match a genre, ignoring case (e.g. "Role-playing (RPG)")
  --platform <name>   Match a platform, ignoring case (e.g. "PC (Microsoft Windows)")
  --json             Print the chosen game as JSON
  --help             Show this help

For a live library, set QUESTARR_URL (default: http://localhost:5000)
and QUESTARR_API_KEY from Settings → Integrations.
Only reads the library; never changes a status or starts a download.
`;

export function readGames(payload) {
  const games = Array.isArray(payload) ? payload : payload?.games;
  if (
    !Array.isArray(games) ||
    games.some(
      (game) =>
        !game ||
        typeof game.id !== "string" ||
        typeof game.title !== "string" ||
        !game.title.trim() ||
        !STATUSES.includes(game.status) ||
        [game.genres, game.platforms].some(
          (names) =>
            names != null && (!Array.isArray(names) || names.some((n) => typeof n !== "string"))
        )
    )
  ) {
    throw new Error("Expected an integration library response ({ games: [...] }) or a game array.");
  }
  return games;
}

export function chooseGame(games, { status = "owned", genre, platform } = {}, draw = randomInt) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Status must be one of: ${STATUSES.join(", ")}.`);
  }
  const matches = (names, filter) =>
    !filter || (names ?? []).some((name) => name.toLowerCase() === filter.trim().toLowerCase());
  // Duplicate exported rows should not give one game extra lottery tickets.
  const candidates = [...new Map(games.map((game) => [game.id, game])).values()].filter(
    (game) =>
      game.status === status && matches(game.genres, genre) && matches(game.platforms, platform)
  );
  if (!candidates.length) return null;
  const game = candidates[draw(candidates.length)];
  return {
    game: {
      id: game.id,
      title: game.title,
      status: game.status,
      genres: game.genres ?? [],
      platforms: game.platforms ?? [],
    },
    candidateCount: candidates.length,
  };
}

export async function fetchLibrary(baseUrl, apiKey) {
  if (!apiKey) throw new Error("Set QUESTARR_API_KEY or use --file with a saved library.");
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("QUESTARR_URL must be an HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("QUESTARR_URL must be an HTTP or HTTPS URL without embedded credentials.");
  }
  // Preserve subdirectory deployments, but discard any query or fragment.
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/integration/library`;
  url.search = "";
  url.hash = "";
  let response;
  try {
    response = await globalThis.fetch(url, {
      headers: { "X-Api-Key": apiKey },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  } catch {
    // Do not echo credentials, URLs or remote error bodies into logs.
    throw new Error("Could not reach Questarr. Check QUESTARR_URL and that the server is running.");
  }
  if (!response.ok) {
    throw new Error(
      `Questarr returned HTTP ${response.status}. Check your URL and integration key.`
    );
  }
  try {
    return readGames(await response.json());
  } catch {
    throw new Error("Questarr returned an invalid library response.");
  }
}

// Library titles are untrusted text: strip terminal escape/control characters.
// eslint-disable-next-line no-control-regex -- Intentionally remove terminal control codes.
const terminalText = (value) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");

export async function main(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
      status: { type: "string", default: "owned" },
      genre: { type: "string" },
      platform: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!STATUSES.includes(values.status)) {
    throw new Error(`Status must be one of: ${STATUSES.join(", ")}.`);
  }
  for (const name of ["file", "genre", "platform"]) {
    if (values[name] !== undefined && !values[name].trim()) {
      throw new Error(`--${name} must not be empty.`);
    }
  }
  const games = values.file
    ? readGames(JSON.parse(await readFile(values.file, "utf8")))
    : await fetchLibrary(env.QUESTARR_URL ?? "http://localhost:5000", env.QUESTARR_API_KEY);
  const result = chooseGame(games, values);
  if (!result) throw new Error("No games match. Try another status, genre or platform.");
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Tonight's quest: ${terminalText(result.game.title)}`);
  console.log(`Chosen from ${result.candidateCount} matching game(s). Your backlog awaits!`);
  if (result.game.platforms.length) {
    console.log(`Platforms: ${terminalText(result.game.platforms.join(", "))}`);
  }
  if (result.game.genres.length)
    console.log(`Genres: ${terminalText(result.game.genres.join(", "))}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Backlog roulette: ${terminalText(error.message)}`);
    process.exitCode = 1;
  });
}
