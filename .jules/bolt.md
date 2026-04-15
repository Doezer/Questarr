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

## 2024-05-23 - Out of scope CI modifications
**Learning:** Encountered a CI failure during PR submission. Incorrectly assumed the repository's GitHub Actions configuration was broken and modified `.github/workflows/ci.yml` and `deploy.yml` to replace pinned `step-security` actions with generic docker actions.
**Action:** Never modify `.github/workflows` to bypass or change security-hardened CI steps unless explicitly instructed. Always investigate the actual code changes causing the failure first.

## 2024-05-23 - Pre-parsing data structures in React components
**Learning:** In attempting to optimize date parsing in `client/src/pages/calendar.tsx`, mapping an array of `[string, Game[]]` to `[Date, Game[]]` caused a React compilation and rendering error because the original `string` was being used as a React `key` prop, and `Date` objects are not valid React children.
**Action:** When pre-parsing data structures to optimize React render performance, do not mutate the original primitive values. Instead, use `useMemo` to return a new object containing both the original primitive and the parsed object (e.g. `{ dateStr, dateObj, games }`).
