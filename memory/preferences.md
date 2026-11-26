# Preferences

Coding style preferences, workflow preferences, and tooling preferences specific to this project.

<!-- Format:
## Category
- Preference item
-->

## Scheduled SonarCloud-fix routine: check existing PRs first
Before fixing any SonarCloud issue, list open AND recently merged PRs, matching both by title terms (SonarCloud / S3776 / cognitive complexity) and by the affected file or function (check each PR's changed files, since a PR titled e.g. "Refactor XML-RPC value parsing" can cover an issue without those terms), and skip issues already covered. The routine was opening a duplicate refactor PR each run (#1415, #1425, #1438 and #1446 overlapped; #1434 merged; #1446 is the one kept). Only fix what no open/merged PR touches; if everything is covered, just report.
