# OpenSSF Best Practices Badge Evidence

This document records the evidence behind Questarr's self-assessment against the
[OpenSSF Best Practices Badge](https://www.bestpractices.dev/) criteria. Each section is
named after the criterion ID used in the badge questionnaire, so it can be linked directly
as the justification for that question.

This is evidence, not policy — for the underlying process/config being evidenced, see the
linked files in each section.

## [report_responses]

> The project MUST acknowledge a majority of bug reports submitted in the last 2-12 months
> (inclusive); the response need not include a fix.

**Status: Met.**

Assessed 2026-07-06 against issues labeled `bug` created 2025-07-06 to 2026-05-06 on
[Doezer/Questarr](https://github.com/Doezer/Questarr):

- 51 bug-labeled issues in the window; 42 filed by outside users (9 were the maintainer's own).
- 41 of 42 (98%) external reports show a maintainer/contributor response: a direct comment
  from the maintainer (38), a substantive reply from an active contributor (2), or clear
  maintainer action — assignment, milestone, and closure (1).
- Only one report (#544) has no visible acknowledgement on GitHub; it was closed within
  minutes by an automation bot, which may reflect off-platform triage that doesn't surface
  as a comment.

## [enhancement_responses]

> The project SHOULD respond to a majority (>50%) of enhancement requests in the last 2-12
> months (inclusive).

**Status: Met.**

Assessed 2026-07-06 against issues labeled `enhancement` created 2025-07-06 to 2026-05-06:

- 79 enhancement issues in the window; 25 filed by outside users (54 were the maintainer's
  own roadmap items).
- 24 of 25 (96%) external requests show some form of response: a maintainer comment (19),
  implementation without a comment — assigned, milestoned, and closed as completed (3), or
  self-resolution by the reporter/community before a maintainer response was needed (2).
- One request (#271) was closed by its own reporter two minutes after filing with no visible
  engagement from anyone.
- The 4 enhancement issues still open in this window each have active comment threads
  (6-25 comments), indicating ongoing discussion rather than neglect.

## [warnings_strict]

> It is SUGGESTED that projects be maximally strict with warnings in the software produced by
> the project, where practical.

**Status: Met**, with room to tighten further.

Assessed 2026-07-06 against `tsconfig.json`, `eslint.config.js`, and `.github/workflows/ci.yml`:

- `tsconfig.json` sets `"strict": true` (the full strict bundle: `strictNullChecks`,
  `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`,
  `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`), applied uniformly across
  client, server, and shared code.
- `eslint.config.js` layers `@eslint/js` recommended + `typescript-eslint` recommended rules,
  plus project additions (`no-var: error`, `react-hooks/rules-of-hooks: error`,
  `no-unused-vars`, `no-explicit-any`, `exhaustive-deps` as warnings).
- CI (`ci.yml`) runs `npm run lint` and `npm run check` (tsc) as unconditional, blocking steps
  on every push, plus project-specific checks with no off-the-shelf equivalent
  (`check:overrides`, `check:deprecated`) and separate SAST/vulnerability-scan workflows.
- Not yet enabled: the opt-in strictness flags beyond the `strict` bundle — `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- `npm run lint` has no `--max-warnings 0`, so ESLint warnings don't fail CI — only hard
  errors do.

## [dynamic_analysis]

> It is SUGGESTED that at least one dynamic analysis tool be applied to any proposed major
> production release of the software before its release.

**Status: Met.**

[`.github/workflows/dast.yml`](/.github/workflows/dast.yml) runs an
[OWASP ZAP](https://www.zaproxy.org/) baseline scan against a live instance of the app:

- Builds the production bundle, boots it on the runner (`npm start`), and waits on
  `/api/health` before scanning — the same production code path that ships in the Docker
  image, not a mock target.
- `zaproxy/action-baseline` spiders the running app and passively checks every response for
  common runtime issues (missing security headers, verbose error output, cookie flags,
  outdated libraries, etc.) — varying inputs by construction, satisfying the criterion
  independent of the project's static coverage numbers.
- Runs on every push to `main`/`release/*` (so it's applied ahead of any tag cut from those
  branches) plus a weekly schedule and manual dispatch, mirroring the cadence already used by
  [vulnerability-scan.yml](/.github/workflows/vulnerability-scan.yml).
- `fail_action: false` for now: the scan runs unconditionally and its HTML/JSON/MD report is
  uploaded as the `zap-baseline-report` workflow artifact, but findings don't yet block CI.
  This is a deliberate first step — a baseline scan on a project this size typically surfaces
  a batch of informational/low findings (e.g. missing `Content-Security-Policy`) that need
  triage before the job can enforce a severity gate the way
  [sast.yml](/.github/workflows/sast.yml) does for Semgrep.
  Tightening to a blocking gate (tracked as follow-up work) should happen once that triage
  pass establishes which findings are expected/accepted vs. real.

This is independent of `warnings_strict`'s test-coverage numbers above (branch coverage
threshold is currently 74%, short of the criterion's 80% automated-test-suite alternative) —
the ZAP scan satisfies `dynamic_analysis` on its own via the "tool that varies inputs" path,
regardless of coverage.

## [dynamic_analysis_enable_assertions]

> It is SUGGESTED that the project use a configuration for at least some dynamic analysis
> (such as testing or fuzzing) which enables many assertions. In many cases these assertions
> should _not_ be enabled in production builds.

**Status: Met.**

Questarr's dynamic analysis is its Vitest suite (`server/__tests__/`, `client/__tests__/`),
which is nothing but assertions — `expect()` calls that fail the run the moment observed
behavior diverges from expected behavior:

- 4,088+ `expect()` assertions across 153 test files (3,040 in `server/__tests__/`, 1,048 in
  `client/__tests__/`) as of 2026-07-14, run on every push via the `build` job in
  [`ci.yml`](/.github/workflows/ci.yml) (`npm test -- --coverage`).
- This is the JS/TS analogue of the C/C++ `NDEBUG` concern the criterion warns about:
  `vitest` and `supertest` are `devDependencies` only (never `dependencies`) in
  `package.json`, and the production Docker image runs `npm prune --omit=dev`
  ([`Dockerfile`](/Dockerfile)) before copying in the built `dist/` output — so the assertion
  layer is structurally excluded from what ships, not just conventionally disabled.
- There is no runtime `assert()`-equivalent left enabled in shipped code either: neither
  `server/` nor `shared/` import Node's `assert` module outside of test files, so there's
  nothing production-side that could throw on an assertion failure or leak internal state
  the way the criterion warns about.
- This is distinct from the request-input validation Questarr _does_ run in production
  (express-validator, Zod schemas in `shared/schema.ts`) — that's boundary validation of
  untrusted input, not the test-only correctness assertions this criterion is about.

## [dynamic_analysis_fixed]

> All medium and higher severity exploitable vulnerabilities discovered with dynamic code
> analysis MUST be fixed in a timely way after they are confirmed.

**Status: Met** — process defined, no findings yet to test it against.

Full policy: [`docs/VULNERABILITY_MANAGEMENT.md` §3](/docs/VULNERABILITY_MANAGEMENT.md#3-dynamic-application-security-testing-dast).

- §3.2 commits to a remediation SLA for every ZAP `High`/`Medium` finding (the criterion's
  "medium or higher" bar) — 30 and 90 days respectively, matching the SLA already applied to
  SCA (§1.2) and SAST (§2.2) findings in the same document.
- The `dast.yml` workflow this policy covers ([`dynamic_analysis`](#dynamic_analysis) above)
  only merged as of this revision, so as of 2026-07-14 no scan has yet run to completion
  against `main` and no High/Medium finding has been confirmed — there is nothing to have
  fixed yet, not an unaddressed backlog. §3.3 records this explicitly rather than silently
  omitting it.
- §3.4 tracks the two gaps that keep this from being a fully-enforced pipeline yet
  (`fail_action` still `false`, findings not yet issue-tracked); revisit this entry once the
  first confirmed finding exercises the SLA in practice.

**Update policy:** revisit each entry when the underlying tooling changes, or roughly every
6 months to keep the 2-12 month evidence windows current.
