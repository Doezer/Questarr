# Goal: Raise Questarr release confidence

Questarr already has strong unit coverage, page-level frontend tests, and Playwright journeys for the core flows — validation, page coverage, and e2e journeys all reached their original targets (see "Phase 1" in [When to Stop](#when-to-stop)). Release confidence now bottlenecks on test _depth_: several large, high-traffic files (`settings.tsx`, `routes.ts`, `storage.ts`) are only shallowly exercised. Phase 2 expands the loop with a fourth component that rewards raising real statement/branch/function/line coverage above the CI-enforced floor, without loosening validation, page coverage, or e2e journeys.

## Fitness Function

```bash
node scripts/goal-score.mjs
node scripts/goal-score.mjs --json
```

### Metric Definition

```
score = validation + page_coverage + e2e_journeys + coverage_depth
```

| Component          | Max | What it measures                                                                                                                                                         |
| ------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Validation**     | 30  | Whether `npm run lint`, `npm run check`, and `npm run test:coverage` (tests + the CI coverage gate) all pass.                                                            |
| **Page coverage**  | 20  | Whether the main frontend surfaces have page-level tests instead of only utility or component coverage.                                                                  |
| **E2E journeys**   | 20  | Whether the highest-value user journeys have dedicated Playwright specs that pass `npm run test:e2e -- --list`.                                                          |
| **Coverage depth** | 30  | Statements/branches/functions/lines pct from `coverage/coverage-summary.json`, scored continuously between the CI floor and an aspirational target (7.5 pts per metric). |

Coverage depth is continuous, not binary: for each metric, `points = clamp((actual% - floor%) / (target% - floor%), 0, 1) * 7.5`. Floor = the threshold enforced in `vitest.config.ts` (the CI gate); target = the aspirational goal this loop pushes toward.

| Metric     | CI floor | Target |
| ---------- | -------- | ------ |
| Statements | 81%      | 85%    |
| Branches   | 74%      | 78%    |
| Functions  | 77%      | 81%    |
| Lines      | 82%      | 86%    |

The floors in this table are the ones hard-coded in the locked `scripts/goal-score.mjs`. Since 2026-09-30 the actual CI gate in `vitest.config.ts` is stricter (83/76/79/84), ratcheted up to keep the Phase 2 gain.

`Tests + coverage gate` reuses the single `npm run test:coverage` run for both the validation pass/fail signal and the `coverage-summary.json` that feeds coverage depth — the suite is not run twice per score.

### Metric Mutability

- [x] **Locked** — `scripts/goal-score.mjs` and its fixed checklists define the ruler. Improve the repo, not the scoring rules.
  - Expanded once on 2026-07-12 with explicit user authorization ("the current direction was good, but it needs to be expanded") to add the `coverage_depth` component. Re-locked after that expansion — do not add further components or change point weights without the same kind of explicit sign-off.
  - Exception: `vitest.config.ts`'s `coverage.thresholds` may be _raised_ (never lowered) once `coverage_depth`'s actual pct sustainably clears a floor, to lock in progress and prevent regression. Never raise a floor above the currently-actual pct.

## Operating Mode

- [x] **Converge** — Stop when criteria met.

### Stopping Conditions

Stop and report when ANY of:

- `score >= 90`
- `validation = 30`, `page_coverage >= 18`, `e2e_journeys >= 18`, and `coverage_depth >= 24`
- 8 consecutive iterations produce no score increase
- 12 iterations completed
- `npm run lint`, `npm run check`, or `npm run test:coverage` cannot complete because the environment is broken

## Bootstrap

1. `npm install`
2. `node scripts/goal-score.mjs --json`
3. Record the baseline: Starting score (Phase 2): `80.4` (validation 30/30, page_coverage 20/20, e2e_journeys 20/20, coverage_depth 10.4/30) — recorded 2026-07-12

## Improvement Loop

```
repeat:
  0. Read iterations.jsonl if it exists — note what has already been tried
  1. node scripts/goal-score.mjs --json > /tmp/before.json
  2. Read the component breakdown and pick the lowest-scoring area
  3. Pick the highest-impact action from the Action Catalog
  4. Make the smallest change that can move that component
  5. Run targeted verification for the touched area
  6. If targeted verification passes, run npm run lint && npm run check && npm run test:coverage
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

### Validation (target: 30/30)

| Action                                                 | Impact     | How                                                                                                                                    |
| ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Remove live network dependencies from route tests      | +10-20 pts | Mock SSRF and downloader/indexer safety checks in route tests so validation does not depend on DNS resolution or outbound networking.  |
| Fix failing validation surfaced by the score script    | +10-30 pts | Repair the smallest failing lint, typecheck, or tests/coverage-gate issue, then re-run the full validation set.                        |
| Tighten flaky fixtures around downloader and API paths | +5-10 pts  | Replace environment-sensitive fixtures with deterministic mocks and assertions so green runs stay green across CI and local sandboxes. |

### Page coverage (target: 20/20)

| Action                   | Impact | How                                                                                          |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| Add a Discover page test | +2 pts | Add a page-level test for the discover screen rather than only mutation or utility coverage. |
| Add a Search page test   | +2 pts | Cover the primary search results flow at the page level.                                     |
| Add a Settings page test | +2 pts | Verify settings surface behavior with a dedicated page test.                                 |
| Add a Stats page test    | +2 pts | Add coverage for the stats screen and its primary visual states.                             |

### E2E journeys (target: 20/20)

| Action                             | Impact   | How                                                                                    |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Add a discover browsing smoke spec | +2.5 pts | Validate that an authenticated user can open Discover and browse results successfully. |
| Add a search journey spec          | +2.5 pts | Cover a basic search from query entry through visible results.                         |
| Add a library journey spec         | +2.5 pts | Exercise the authenticated library flow in the browser end to end.                     |
| Add a downloads journey spec       | +2.5 pts | Add a smoke test for opening and inspecting the downloads queue.                       |

### Coverage depth (target: 30/30)

Impact ranges are approximate — actual movement depends on how many statements/branches/functions/lines the new assertions exercise (see the continuous scoring formula above). Prioritize files with both low pct and a high missed-line count.

| Action                                                             | Impact          | How                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expand `client/__tests__/SettingsPage.test.tsx`                    | +1-3 pts        | `settings.tsx` is the largest source file in the repo and has only shallow coverage despite already having a test file — add cases for untested tabs, save/validation paths, and conditional renders. |
| Expand `client/__tests__/DiscoverPage.test.tsx`                    | +0.5-1 pt       | Cover filter/sort branches and empty/error states not yet exercised.                                                                                                                                  |
| Add targeted `server/storage.ts` unit tests                        | +0.5-2 pts      | Cover storage-layer query branches (not just the happy path) that `api_routes.test.ts` only exercises indirectly.                                                                                     |
| Add targeted `server/cron.ts` unit tests                           | +0.5-1 pt       | Cover scheduled-job branches (auto-search, xREL monitoring, RSS) with deterministic time/mock fixtures.                                                                                               |
| Add targeted tests for indexer clients (`torznab.ts`/`newznab.ts`) | +0.5-1 pt       | Cover parsing/error branches for malformed or partial indexer responses.                                                                                                                              |
| Ratchet `vitest.config.ts` coverage thresholds upward              | 0 pts (lock-in) | Once an actual pct sustainably clears its floor by a comfortable margin, raise that floor (never above actual) so CI catches future regressions.                                                      |

## Constraints

1. **Do not weaken the score definition** — `scripts/goal-score.mjs` and its fixed checklists are locked so the number cannot be gamed (see [Metric Mutability](#metric-mutability) for the one-time, user-authorized exception already used).
2. **No new production dependencies** — improve confidence with the existing stack unless a human explicitly asks otherwise.
3. **Validation stays honest** — never stub production behavior outside tests, and never claim a command passed unless the command itself passed.
4. **Network-sensitive tests must be deterministic** — unit and integration tests cannot depend on live DNS or external network availability unless the test is explicitly about SSRF/network behavior.
5. **Prefer page and journey coverage over utility-only coverage** — this loop is about release confidence, so new tests should exercise real user-facing surfaces whenever practical.
6. **Coverage depth tests must assert real behavior** — never write a test purely to touch a line/branch without a meaningful assertion; padding the metric without adding confidence defeats the goal.

## File Map

| File                                  | Role                                                | Editable?                                                         |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `GOAL.md`                             | Goal definition and operating loop                  | Yes                                                               |
| `scripts/goal-score.mjs`              | Fitness function                                    | No (re-locked 2026-07-12 after coverage_depth expansion)          |
| `vitest.config.ts`                    | CI coverage-threshold gate (`coverage_depth` floor) | Yes — only to raise thresholds toward actual, never to lower them |
| `iterations.jsonl`                    | Iteration log                                       | Append only                                                       |
| `server/__tests__/api_routes.test.ts` | Broad API route regression coverage                 | Yes                                                               |
| `server/__tests__/*.test.ts`          | Server unit/integration coverage depth              | Yes                                                               |
| `client/__tests__/*.test.tsx`         | Page-level frontend coverage                        | Yes                                                               |
| `client/src/__tests__/*.test.tsx`     | Setup/auth frontend coverage                        | Yes                                                               |
| `tests/e2e/*.spec.ts`                 | End-to-end journey coverage                         | Yes                                                               |

## When to Stop

### Phase 1 (complete)

```
Starting score: 73.0
Ending score:   100.0
Iterations:     2
Changes made:
  - Iteration 1: Remove live DNS dependency from Synology downloader route tests; add
    GOAL loop infrastructure (goal-score.mjs, GOAL.md) — score 63→73
  - Iteration 2: Add page-level tests for Discover, Search, Settings, Stats, Calendar,
    Downloads, Library (mobile), Wishlist (mobile), Logs; add full LogsPage
    implementation; add E2E journey specs for Discover, Search, Library, Downloads
    — score 73→100
Re-verified: 2026-07-05 — score confirmed at 100.0. A local, uncommitted migration
  (0021) duplicated table/column definitions already applied in earlier migrations
  (0015/0016/0019/0020), which broke `npm run test:run` and dropped validation to
  20/40 (score 80). Fixed by correcting the migration file; no code or test changes
  were needed. Lesson: drizzle migrations generated against a stale local snapshot
  can silently duplicate prior migrations — diff a freshly generated migration
  against existing ones before committing.
Remaining gaps:
  - SearchPage test covers the date-filter and infinite-scroll flows but not every edge
    case; expand as the feature matures
  - WishlistPage mobile test covers stacked sections; tab-layout interaction tests could
    be added for deeper mobile confidence
Next actions:
  - Coverage gate in CI: already in place (Codecov project/patch thresholds in
    codecov.yml, wired into .github/workflows/ci.yml) — no action needed
  - Expand E2E journeys to cover the full pipeline (add game → auto-search → download
    → post-process)
  - Mobile responsiveness pass once thumb-first layout work lands
```

### Phase 2 (complete)

```
Starting score (Phase 2): 80.4 — recorded 2026-07-12
  validation 30/30, page_coverage 20/20, e2e_journeys 20/20, coverage_depth 10.4/30
Baseline coverage_depth breakdown:
  Statements 82.43% (floor 81%, target 85%) — 2.68/7.5
  Branches   75.05% (floor 74%, target 78%) — 1.97/7.5
  Functions  78.52% (floor 77%, target 81%) — 2.85/7.5
  Lines      83.56% (floor 82%, target 86%) — 2.93/7.5
Ending score (Phase 2): 100.0 — reached 2026-09-30 (stopping condition: score >= 90)
  Baseline for this run, measured on main @ c76a56a: 88.1
    validation 30/30, page_coverage 20/20, e2e_journeys 20/20, coverage_depth 18.1/30
    Statements 83.63%, Branches 75.86%, Functions 79.29%, Lines 84.87%
  After: coverage_depth 30/30
    Statements 85.01%, Branches 78.13%, Functions 82.12%, Lines 86.34%
Iterations: 2 logged (iteration 5, then iteration 6 on 2026-09-30)
Changes made:
  - Iteration 6: page-level tests for the Downloaders page (was 1.5% branch
    coverage: list ordering and badges, enable toggle, priority clamping,
    delete/test outcomes, per-client-type form fields, default-port and SSL
    port switching, qBittorrent initial state, add/test/save and validation)
    and for the 1.5.0 game journal tab (was 0%: Steam achievements gating,
    notes, milestones, screenshot upload/lightbox/delete, error toast)
    — score 88.1 -> 100
  - Ratcheted the vitest.config.ts floors to 83/76/79/84 (each about 2 points
    under the measured value) so CI keeps the gain.
Remaining gaps (next targets if the loop restarts with higher targets):
  - server/routes.ts (about 400 uncovered branches), client/src/pages/settings.tsx
    (about 240), server/storage.ts (about 190), GameDownloadDialog.tsx and
    GameDetailsModal.tsx (about 100 each).
```

### E2E pass for 1.7.0 (2026-11-26)

```
Baseline: 60 Playwright tests, all green on main @ 6314e34 (no flaky or broken spec found).
After:    69 tests, all green (two workers, local run).
Added specs (tests/e2e):
  - setup-wizard.spec.ts            wizard prompt, step navigation, skip, state API validation, rerun from Settings
  - system-pages.spec.ts            Diagnostics checks, System Tasks list, Backups create/list/schedule/delete
  - play-session-edit.spec.ts       split and merge from the Playtime section, 30-minute merge gap, invalid input
  - webhooks.spec.ts                add a webhook, secret shown once and never listed, delete
  - import-upgrade-settings.spec.ts add-on subfolder switch and previous-version choice persist across reload
  - auto-upgrade-settings.spec.ts   "Updates for Owned Games" policy and the Download Rules it unlocks
  - helpers.ts                      new apiSend() for CSRF-protected API calls
Not covered yet (next candidates): restoring a backup, webhook test delivery (needs an
  external listener), the Playnite play-status routes, RomM "Fix misplaced folders",
  Real-Debrid, recommendations (needs IGDB), classification cache clearing.
```
