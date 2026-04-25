---
name: release-notes
description: Generate formatted release notes from git commits since the last tag and prepend them to CHANGELOG.md
disable-model-invocation: false
---

1. Run `git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges` to get commits since the last tag.
2. Determine the new version from the current `release/*` branch name (e.g. `release/1.3.0` → `1.3.0`).
3. Get today's date in `YYYY-MM-DD` format.
4. Group commits by type using these categories (skip merge commits and anything without meaningful user impact):
   - **Added** — `feat:` commits
   - **Fixed** — `fix:` commits
   - **Changed** — `chore:`, `refactor:`, `perf:`, `update:`, `deps:` commits
   - **Security** — commits mentioning security, SSRF, CVE, auth, or vulnerability
5. Format the output as a markdown changelog section:

   ```
   ## [VERSION] - DATE

   ### Added
   - ...

   ### Fixed
   - ...

   ### Changed
   - ...
   ```

   Omit sections that have no entries. Write bullet points in plain English (no commit hashes), and mention PR numbers where present.

6. Read `docs/CHANGELOG.md`, then prepend the new section immediately after the `# Changelog` header line (before the first existing `## [...]` section), and write the file back.
7. Display the generated section to the user.
