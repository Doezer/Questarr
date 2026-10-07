# Backlog roulette

Too many games, nothing to play? Let Questarr pick tonight's quest from your
owned games:

```sh
node scripts/backlog-roulette.mjs
```

Run this from a source checkout with Node.js 22.19 or later. No npm install or
additional dependencies are needed.

For a live library, set `QUESTARR_URL` to your Questarr instance (defaults to
`http://localhost:5000`) and `QUESTARR_API_KEY` to a key created under
**Settings → Integrations**. Supply the key through your environment rather than
as a command argument. Use HTTPS when connecting across an untrusted network.
Subdirectory URLs such as `https://example.com/questarr/` are supported.

The command makes one GET to `/api/integration/library`. Questarr's existing
hidden-game and content filters apply. It never changes game status, requests a
game, launches a game or starts a download. Redirects are rejected so the key is
not forwarded to another destination; requests time out after ten seconds.

## Set the mood

```sh
# An RPG night
node scripts/backlog-roulette.mjs --genre "Role-playing (RPG)"

# Finish something you've already started
node scripts/backlog-roulette.mjs --status playing

# Pick a PC game and return JSON for another tool
node scripts/backlog-roulette.mjs --platform "PC (Microsoft Windows)" --json
```

Genre and platform filters match full names, ignoring case and surrounding
spaces. Combine them to narrow the draw. Status defaults to `owned`; explicit
choices are `wanted`, `owned`, `playing`, `completed` and `shelved`. Each unique
matching game has an equal chance. No matches produces an explanation and exit
code 1, without silently broadening your filters.

## Play offline

Save an integration-library response (`{ "games": [...] }`) or an array of those
game objects to a JSON file, then run:

```sh
node scripts/backlog-roulette.mjs --file library.json
```

Each game needs a string `id`, a nonempty `title` and a valid `status`.
`genres` and `platforms` are optional arrays of names. Offline mode uses only the
file you supply; no server connection or API key is needed. The draw does not
persist a history, so running it again may choose the same game.

Show all options with `--help`. Verify the command with its dependency-free tests:

```sh
node --test scripts/__tests__/backlog-roulette.node.mjs
```
