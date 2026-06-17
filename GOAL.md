# Goal: Raise Questarr release confidence

Questarr already has strong unit coverage and several mobile-focused tests, but release confidence still depends too much on manual inspection. The next step is to make confidence explicit: keep validation green, close page-level frontend test gaps, and expand end-to-end coverage for the core user journeys that matter most.

## Fitness Function

```bash
node scripts/goal-score.mjs
node scripts/goal-score.mjs --json
```

### Metric Definition

```
score = validation + page_coverage + e2e_journeys
```

| Component         | Max | What it measures                                                                                        |
| ----------------- | --- | ------------------------------------------------------------------------------------------------------- |
| **Validation**    | 40  | Whether `npm run lint`, `npm run check`, and `npm run test:run` all pass.                               |
| **Page coverage** | 30  | Whether the main frontend surfaces have page-level tests instead of only utility or component coverage. |
| **E2E journeys**  | 30  | Whether the highest-value user journeys have dedicated Playwright specs.                                |

### Metric Mutability

- [x] **Locked** — `scripts/goal-score.mjs` and its fixed checklists define the ruler. Improve the repo, not the scoring rules.

## Operating Mode

- [x] **Converge** — Stop when criteria met.

### Stopping Conditions

Stop and report when ANY of:

- `score >= 90`
- `validation = 40`, `page_coverage >= 24`, and `e2e_journeys >= 24`
- 8 consecutive iterations produce no score increase
- 12 iterations completed
- `npm run lint`, `npm run check`, or `npm run test:run` cannot complete because the environment is broken

## Bootstrap

1. `npm install`
2. `node scripts/goal-score.mjs --json`
3. Record the baseline: Starting score: `73.0`

## Improvement Loop

```
repeat:
  0. Read iterations.jsonl if it exists — note what has already been tried
  1. node scripts/goal-score.mjs --json > /tmp/before.json
  2. Read the component breakdown and pick the lowest-scoring area
  3. Pick the highest-impact action from the Action Catalog
  4. Make the smallest change that can move that component
  5. Run targeted verification for the touched area
  6. If targeted verification passes, run npm run lint && npm run check && npm run test:run
  7. node scripts/goal-score.mjs --json > /tmp/after.json
  8. If score improved without regression, commit
  9. If score stayed flat or regressed, revert
  10. Append one JSON line to iterations.jsonl with before/after scores, action, and result
  11. Continue
```

Commit messages: `[S:NN.N→NN.N] component: what changed`

## Iteration Log

File: `iterations.jsonl` (append-only, one JSON object per line)

## Action Catalog

### Validation (target: 40/40)

| Action                                                 | Impact     | How                                                                                                                                    |
| ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Remove live network dependencies from route tests      | +20 pts    | Mock SSRF and downloader/indexer safety checks in route tests so validation does not depend on DNS resolution or outbound networking.  |
| Fix failing validation surfaced by the score script    | +10-20 pts | Repair the smallest failing lint, typecheck, or unit/integration test issue, then re-run the full validation set.                      |
| Tighten flaky fixtures around downloader and API paths | +5-10 pts  | Replace environment-sensitive fixtures with deterministic mocks and assertions so green runs stay green across CI and local sandboxes. |

### Page coverage (target: 30/30)

| Action                   | Impact | How                                                                                          |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| Add a Discover page test | +3 pts | Add a page-level test for the discover screen rather than only mutation or utility coverage. |
| Add a Search page test   | +3 pts | Cover the primary search results flow at the page level.                                     |
| Add a Settings page test | +3 pts | Verify settings surface behavior with a dedicated page test.                                 |
| Add a Stats page test    | +3 pts | Add coverage for the stats screen and its primary visual states.                             |

### E2E journeys (target: 30/30)

| Action                             | Impact   | How                                                                                    |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Add a discover browsing smoke spec | +3.8 pts | Validate that an authenticated user can open Discover and browse results successfully. |
| Add a search journey spec          | +3.8 pts | Cover a basic search from query entry through visible results.                         |
| Add a library journey spec         | +3.8 pts | Exercise the authenticated library flow in the browser end to end.                     |
| Add a downloads journey spec       | +3.8 pts | Add a smoke test for opening and inspecting the downloads queue.                       |

## Constraints

1. **Do not weaken the score definition** — `scripts/goal-score.mjs` and its fixed checklists are locked so the number cannot be gamed.
2. **No new production dependencies** — improve confidence with the existing stack unless a human explicitly asks otherwise.
3. **Validation stays honest** — never stub production behavior outside tests, and never claim a command passed unless the command itself passed.
4. **Network-sensitive tests must be deterministic** — unit and integration tests cannot depend on live DNS or external network availability unless the test is explicitly about SSRF/network behavior.
5. **Prefer page and journey coverage over utility-only coverage** — this loop is about release confidence, so new tests should exercise real user-facing surfaces whenever practical.

## File Map

| File                                  | Role                                | Editable?   |
| ------------------------------------- | ----------------------------------- | ----------- |
| `GOAL.md`                             | Goal definition and operating loop  | Yes         |
| `scripts/goal-score.mjs`              | Fitness function                    | No          |
| `iterations.jsonl`                    | Iteration log                       | Append only |
| `server/__tests__/api_routes.test.ts` | Broad API route regression coverage | Yes         |
| `client/__tests__/*.test.tsx`         | Page-level frontend coverage        | Yes         |
| `client/src/__tests__/*.test.tsx`     | Setup/auth frontend coverage        | Yes         |
| `tests/e2e/*.spec.ts`                 | End-to-end journey coverage         | Yes         |

## When to Stop

```
Starting score: 73.0
Ending score:   NN.N
Iterations:     N
Changes made:   (list)
Remaining gaps: (list)
Next actions:   (what a future agent or human should tackle next)
```
