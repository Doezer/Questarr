# Preferences

Coding style preferences, workflow preferences, and tooling preferences specific to this project.

<!-- Format:
## Category
- Preference item
-->

## Scheduled SonarCloud-fix routine: check existing PRs first
Before fixing any SonarCloud issue, list open AND recently merged PRs (titles mentioning SonarCloud / S3776 / cognitive complexity) and skip issues already covered. The routine was opening a duplicate refactor PR each run (#1415, #1425, #1438, #1446 all overlap; #1434 merged). Only fix what no open/merged PR touches; if everything is covered, just report.
