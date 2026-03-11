## 2024-05-23 - N+1 Query Optimization
**Learning:** Sequential API calls in a loop (N+1 pattern) significantly degrade performance.
**Action:** Always prefer batched API methods (like `getGamesByIds`) and process updates in concurrency-limited chunks (e.g., using `Promise.all` with a chunking loop).

## 2025-02-18 - SQLite Batch Updates
**Learning:** SQLite performance for bulk updates is heavily dependent on transaction overhead. Updating items one-by-one in a loop creates implicit transactions for each update, which is slow.
**Action:** Wrap multiple update statements in a single `db.transaction` (batching) to significantly reduce I/O overhead and increase throughput.

## 2025-05-23 - Batch Transaction Optimization
**Learning:** Performing multiple inserts/updates in a loop without a transaction causes significant I/O overhead due to repeated fsyncs.
**Action:** Encapsulate bulk synchronization logic (like syncing indexers) within a single `db.transaction` in the storage layer, and pre-fetch existing records to avoid N+1 read queries.

## 2024-03-11 - Memoize Array Filtering
**Learning:** In React components that derive heavily filtered arrays from larger datasets (like `games.filter(...)`), failing to memoize these arrays causes O(n) recalculations on every single re-render (e.g., when a user merely toggles a local state like view mode). Furthermore, if these un-memoized arrays are then used as dependencies for *other* `useMemo` hooks, it completely defeats the purpose of those subsequent hooks because the referential equality of the array changes every render.
**Action:** Always wrap derived filtering operations in `useMemo` when working with potentially large lists in React, especially if the resulting array is used as a dependency downstream or passed as a prop to child components. Added `useMemo` to `libraryGames` and `wishlistGames` to prevent these unnecessary CPU cycles.
