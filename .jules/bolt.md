## 2024-05-23 - N+1 Query Optimization
**Learning:** Sequential API calls in a loop (N+1 pattern) significantly degrade performance.
**Action:** Always prefer batched API methods (like `getGamesByIds`) and process updates in concurrency-limited chunks (e.g., using `Promise.all` with a chunking loop).

## 2025-02-18 - SQLite Batch Updates
**Learning:** SQLite performance for bulk updates is heavily dependent on transaction overhead. Updating items one-by-one in a loop creates implicit transactions for each update, which is slow.
**Action:** Wrap multiple update statements in a single `db.transaction` (batching) to significantly reduce I/O overhead and increase throughput.
