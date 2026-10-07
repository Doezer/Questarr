import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { chooseGame, fetchLibrary, readGames } from "../backlog-roulette.mjs";

const game = (id, status = "owned", extra = {}) => ({
  id,
  title: `Game ${id}`,
  status,
  platforms: ["PC (Microsoft Windows)"],
  genres: ["Role-playing (RPG)"],
  ...extra,
});

test("defaults to owned games, excluding the rest of the backlog", () => {
  const games = ["wanted", "playing", "completed", "shelved", "owned"].map((s) => game(s, s));
  assert.equal(chooseGame(games).game.id, "owned");
  assert.equal(chooseGame(games).candidateCount, 1);
});

test("filters by status, genre and platform together, ignoring case and padding", () => {
  const games = [
    game("1", "playing"),
    game("2", "playing", { genres: ["Adventure"] }),
    game("3", "playing", { platforms: ["Linux"] }),
    game("4"),
  ];
  const result = chooseGame(games, {
    status: "playing",
    genre: " role-PLAYING (rpg) ",
    platform: "pc (microsoft windows)",
  });
  assert.equal(result.game.id, "1");
  assert.equal(result.candidateCount, 1);
});

test("every unique matching game can be drawn, without mutating the library", () => {
  const games = [game("1"), game("2"), game("1")];
  const before = structuredClone(games);
  for (let i = 0; i < 2; i++) {
    const result = chooseGame(games, {}, (count) => {
      assert.equal(count, 2);
      return i;
    });
    assert.equal(result.game.id, String(i + 1));
  }
  assert.deepEqual(games, before);
});

test("empty libraries and unmatched filters return no selection", () => {
  assert.equal(chooseGame([]), null);
  assert.equal(chooseGame([game("1")], { genre: "Adventure" }), null);
  assert.equal(chooseGame([game("1", "owned", { genres: null })], { genre: "RPG" }), null);
});

test("accepts API responses and game arrays with missing optional metadata", () => {
  const games = [game("1", "owned", { genres: null, platforms: undefined })];
  assert.deepEqual(readGames({ games, count: 1 }), games);
  assert.deepEqual(readGames(games), games);
  assert.deepEqual(chooseGame(games).game.genres, []);
});

test("rejects malformed library data and unknown statuses", () => {
  for (const payload of [
    null,
    {},
    { games: {} },
    [null],
    [game("1", "unknown")],
    [game("1", "owned", { title: " " })],
    [game("1", "owned", { genres: [123] })],
  ]) {
    assert.throws(() => readGames(payload), /Expected an integration library/);
  }
  assert.throws(() => chooseGame([], { status: "anything" }), /Status must be/);
});

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("live mode makes one authenticated GET and preserves the base path", async () => {
  let requests = 0;
  await withServer(
    (req, res) => {
      requests++;
      assert.equal(req.method, "GET");
      assert.equal(req.url, "/questarr/api/integration/library");
      assert.equal(req.headers["x-api-key"], "test-key");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ games: [game("1")], count: 1 }));
    },
    async (base) => {
      assert.equal(
        (await fetchLibrary(`${base}/questarr/?ignored=yes#fragment`, "test-key"))[0].id,
        "1"
      );
    }
  );
  assert.equal(requests, 1);
});

test("HTTP errors do not print the server body or key", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(401);
      res.end("sensitive response body");
    },
    async (base) => {
      await assert.rejects(fetchLibrary(base, "secret-key"), (err) => {
        assert.match(err.message, /HTTP 401/);
        assert.doesNotMatch(err.message, /sensitive|secret-key/);
        return true;
      });
    }
  );
});

test("redirects fail without forwarding credentials", async () => {
  let requests = 0;
  await withServer(
    (_req, res) => {
      requests++;
      res.writeHead(302, { Location: "/other" });
      res.end();
    },
    async (base) => {
      await assert.rejects(fetchLibrary(base, "test-key"), /Could not reach Questarr/);
    }
  );
  assert.equal(requests, 1);
});

test("rejects invalid JSON and missing credentials with actionable errors", async () => {
  await assert.rejects(fetchLibrary("http://localhost:5000"), /Set QUESTARR_API_KEY/);
  await assert.rejects(fetchLibrary("file:///tmp/library", "key"), /HTTP or HTTPS/);
  await assert.rejects(
    fetchLibrary("https://user:password@example.com", "key"),
    /without embedded/
  );
  await withServer(
    (_req, res) => res.end("<html>wrong endpoint</html>"),
    async (base) => {
      await assert.rejects(fetchLibrary(base, "key"), /invalid library response/);
    }
  );
});

test("CLI supports help, offline JSON output, safe terminal text and failures", async () => {
  const script = new URL("../backlog-roulette.mjs", import.meta.url);
  const run = (...args) =>
    spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8" });
  assert.equal(run("--help").status, 0);
  assert.match(run("--help").stdout, /Questarr backlog roulette/);
  assert.equal(run("--status", "unknown").status, 1);
  assert.equal(run("--genre", " ").status, 1);
  assert.equal(run("--not-an-option").status, 1);
  const dir = await mkdtemp(path.join(tmpdir(), "questarr-roulette-"));
  try {
    const file = path.join(dir, "library.json");
    await writeFile(
      file,
      JSON.stringify({ games: [game("1", "owned", { title: "Portal\u001b[2J\n" })] })
    );
    const json = run("--file", file, "--json");
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).game.id, "1");
    const plain = run("--file", file);
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout, /\u001b/);
    const empty = run("--file", file, "--status", "completed");
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /No games match/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
