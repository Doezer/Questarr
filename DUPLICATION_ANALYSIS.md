# Issue Duplication Analysis: #1034 vs #1015

## Overview
Both issues appear to address the **same underlying problem**: qBittorrent v5+ returns async responses (`pending_count: 1`, empty `added_torrent_ids`) that leave downloads untracked in Questarr. However, the relationship between #995 and #885 should be verified to confirm they are indeed the same root cause.

| Aspect | #1015 | #1034 |
|--------|-------|-------|
| **Title** | fix: track downloads when qBittorrent v5+ returns async pending_count | fix(cron): recover qBittorrent downloads added with async/pending response |
| **Author** | ForceConstant | DenisBY |
| **Fixes** | #995 | #885 |
| **State** | Open (14 comments) | Open (2 comments) |
| **Tests** | 22 new tests, 63/63 across 5 files | Unit tests mentioned but integrated in cron |

---

## Problem Statement (Shared)

When qBittorrent v5+ accepts a torrent URL asynchronously:
1. It returns immediately with `pending_count: 1` and an empty `added_torrent_ids` list
2. The torrent hash is not yet known
3. Questarr cannot create a `game_downloads` tracking record without a hash
4. The download proceeds in qBittorrent but remains invisible to Questarr
5. The game status stays "wanted" even though the download is active

---

## Proposed Solutions

### #1015: Correlation Tag Approach
**Strategy**: Track from the start with a temporary identifier, resolve later.

**Implementation**:
- Returns `correlationTag` from qBittorrent async adds (e.g., `"questarr-add-abc123"`)
- Route creates `game_downloads` record **upfront** with `downloadHash: correlationTag`
- Cron task `resolveAsyncDownloads()` periodically:
  - Fetches downloads by tag using `findTorrentByTag()` (qBittorrent's tag API)
  - Resolves the correlation tag to the real hash
  - Calls `updateGameDownloadHash()` to replace temporary hash with real hash
- Non-qBittorrent downloaders: `findTorrentByTag()` is a no-op

**Pros**:
- Tracks the download record immediately → game status updates instantly
- Deterministic: only processes downloads that Questarr created
- Minimal surface area: resolves only tagged torrents
- Clean separation: creation concern (route) vs. resolution concern (cron)

**Cons**:
- Requires `updateGameDownloadHash()` method across storage layer
- Needs a `correlationTag` convention for all downloads (including non-async ones)
- qBittorrent-specific: only works if client supports tags

**Coverage**:
- 4 cron resolution tests (tag→hash, unresolved skip, non-async skip, resolve+complete)
- 7 downloader tag-lookup tests
- 5 qBittorrent regression tests
- 1 route-level async reproduction test
- 3 storage update tests

---

### #1034: Sync Untracked Downloads Approach
**Strategy**: Periodically scan downloaders and match untracked torrents to wanted games.

**Implementation**:
- New cron task `syncUntrackedDownloads()` runs after every `checkDownloadStatus()` (every 60s)
- For each user/game/downloader combination:
  1. Fetch all wanted games grouped by user
  2. Fetch active downloads from every enabled downloader
  3. Filter: hashes NOT in `game_downloads`
  4. Match: remaining torrent name → wanted game title using `releaseMatchesGame()`
  5. Skip if game already has an active sibling download
  6. Insert new `game_downloads` row + update game status to `downloading`

**Pros**:
- Downloader-agnostic: works with any client, not just qBittorrent
- Resilient to any async race condition (qBittorrent, Transmission, etc.)
- Already-tested `releaseMatchesGame()` logic reused
- No schema changes needed

**Cons**:
- Runs every 60s even when no async downloads exist
- Higher computational cost: scans all games and all downloader activities
- Matching is best-effort: relies on title normalization (could have false positives/negatives)
- Detects the problem after the fact, not preventing it upfront
- Creates "zombie" downloads: tracking record exists but may have wrong hash initially

---

## Fundamental Trade-off

| Dimension | #1015 | #1034 |
|-----------|-------|-------|
| **Tracking** | Immediate (on route response) | Delayed (on next cron run) |
| **Scope** | qBittorrent-specific | All downloaders |
| **CPU cost** | Low: only resolve tagged items | Higher: scan all games/downloads |
| **Complexity** | Schema + tag logic | Title matching |
| **Determinism** | High: we created these downloads | Medium: inferred from title match |
| **Recovery** | Automatic after hash resolves | Best-effort from existing torrent names |

---

## Recommendation

**#1015 should be the primary fix** because:
1. **Immediate tracking**: Game status updates instantly when the download is queued
2. **Deterministic**: Questarr only processes downloads it initiated (via tags)
3. **Lower overhead**: No full-table scans; resolves only tagged items
4. **Scope-appropriate**: qBittorrent async pending is a qBittorrent problem

**However, #1034 has merit as a complementary safety net**:
- Catches untracked downloads from other sources (manual qBittorrent adds, failed route responses, etc.)
- Runs less frequently (e.g., every 5–10 minutes) rather than every 60s
- Could be behind a feature flag or config option initially

---

## Path Forward

### Option A: Land #1015 (recommended)
- Merge #1015 as the primary fix
- Mark #1034 as "duplicate" or "deferred enhancement"
- If #1034's recovery use case is needed later, revisit with reduced frequency (5–10m instead of 60s)

### Option B: Combine Both
- Merge #1015 for immediate tracking (qBittorrent-specific, deterministic)
- Merge #1034 as a secondary recovery mechanism (generic, best-effort)
- Run #1034 at lower frequency (5–10m) to reduce overhead
- Document that #1015 is the primary path; #1034 catches edge cases

### Option C: Merge #1034 into #1015
- Have #1015 author expand scope to include `syncUntrackedDownloads()`
- Lower #1034's frequency to avoid excessive scanning
- Single, comprehensive PR covering both prevention (tags) and recovery (scan)

---

## Files to Review

### #1015 Changes
- `server/routes.ts` — route creates game_downloads upfront
- `server/cron.ts` — `resolveAsyncDownloads()` task
- `server/downloaders.ts` — `findTorrentByTag()` interface
- `server/storage.ts` — `updateGameDownloadHash()` method
- Test files (5 files, 22 tests)

### #1034 Changes
- `server/cron.ts` — `syncUntrackedDownloads()` task
- Uses existing `releaseMatchesGame()` logic
- Test coverage integrated into cron test suite

---

## Next Steps
1. **Clarify with PR authors**: What was the original decision that led to two separate approaches?
2. **Check issue #995 and #885**: Are they truly the same root cause?
3. **Choose a path**: Options A, B, or C above
4. **Consolidate**: Merge/close one PR, update the other, or integrate both
