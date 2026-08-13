---
name: investigate-issue
description: Investigate a Questarr GitHub issue by pulling the linked log entry from the private Doezer/Questarr-logs repo and cross-referencing it against the codebase
disable-model-invocation: false
---

Questarr users can submit scrubbed server logs from the in-app "Send Logs" dialog
(`client/src/pages/logs.tsx`). Submission creates an issue in the **private**
`Doezer/Questarr-logs` repo, and the public issue the user files in `Doezer/Questarr`
gets a pre-filled body containing a line like:

```
**Support log #:** `ABCD` (Doezer/Questarr-logs#123)
```

Use this skill when asked to investigate, diagnose, or debug a Questarr issue that
may have an attached support log.

1. **Resolve the target issue.** The user will give an issue number or URL in
   `Doezer/Questarr` (default to that repo if unspecified). Fetch the issue body and
   comments with whatever GitHub tooling is available in this session (GitHub MCP
   tools, or `gh issue view` if running locally).

2. **Find the log reference.** Search the issue body/comments for a
   `Doezer/Questarr-logs#<N>` reference.
   - If found, that `<N>` is the issue number to fetch in the log repo.
   - If the body only has a bare support code (`**Support log #:** CODE`) with no
     `Doezer/Questarr-logs#<N>` reference, the issue predates this cross-linking
     feature (or the reporter edited the template). There is no way to resolve that
     code to a log issue from the repo alone — say so plainly and ask the user for
     the log issue number/link instead of guessing.

3. **Get access to the log repo.** `Doezer/Questarr-logs` is private. If it isn't
   already in scope for this session, attach it (e.g. `add_repo` in Claude Code
   Remote, or confirm `gh repo view Doezer/Questarr-logs` succeeds locally) before
   trying to read it.

4. **Fetch the log entry.** Read the referenced issue in `Doezer/Questarr-logs` —
   the body holds the scrubbed NDJSON log dump the user submitted, plus app version,
   platform, and timestamp fields set by the log-collector worker.

5. **Cross-reference.** Parse the NDJSON lines (same shape as `client/src/pages/logs.tsx`
   parses: `level`, `time`, `module`, `msg`, plus arbitrary structured fields). Match
   error messages, module names, and stack traces against the Questarr codebase
   (`server/`, `client/src/`) to locate the likely cause. Tie specific log lines to
   specific files/lines in your findings rather than speculating in the abstract.

6. **Report back** referencing both the public issue and the specific log lines that
   support the diagnosis, so the maintainer can verify the reasoning against the
   source log.
