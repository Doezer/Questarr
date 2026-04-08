## 2024-05-23 - N+1 Query Optimization
**Learning:** Sequential API calls in a loop (N+1 pattern) significantly degrade performance.
**Action:** Always prefer batched API methods (like `getGamesByIds`) and process updates in concurrency-limited chunks (e.g., using `Promise.all` with a chunking loop).

## 2025-02-18 - SQLite Batch Updates
**Learning:** SQLite performance for bulk updates is heavily dependent on transaction overhead. Updating items one-by-one in a loop creates implicit transactions for each update, which is slow.
**Action:** Wrap multiple update statements in a single `db.transaction` (batching) to significantly reduce I/O overhead and increase throughput.

## 2025-05-23 - Batch Transaction Optimization
**Learning:** Performing multiple inserts/updates in a loop without a transaction causes significant I/O overhead due to repeated fsyncs.
**Action:** Encapsulate bulk synchronization logic (like syncing indexers) within a single `db.transaction` in the storage layer, and pre-fetch existing records to avoid N+1 read queries.

## 2024-03-18 - Missing memoization in frequently rendered components
**Learning:** Found that multiple components like `AppSidebar`, `library.tsx`, and `wishlist.tsx` were performing O(n) array filtering (`games.filter(...)`) on every render. Because `AppSidebar` renders on every page and updates frequently (e.g. from active downloads polling), these unmemoized calculations could cause noticeable jank as the library grows.
**Action:** Always check if derived array data (like filtering or sorting) in top-level or frequently updated components is properly wrapped in `useMemo`, especially when the source array comes from a global query cache like React Query.

## 2025-05-23 - Unmemoized React Query array data transformations
**Learning:** React Query frequently triggers re-renders on components. Any heavy transformation derived from query results (e.g. filtering, O(N log N) sorting, date parsing) directly inside the component body will fire on every re-render and degrade performance.
**Action:** Extract list transformations or sorting using results from React Query into `useMemo`, ensuring `searchResults?.items` or equivalent array paths are added to the dependency array.
