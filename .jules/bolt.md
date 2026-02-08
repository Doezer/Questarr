## 2024-05-23 - N+1 Query Optimization
**Learning:** Sequential API calls in a loop (N+1 pattern) significantly degrade performance.
**Action:** Always prefer batched API methods (like `getGamesByIds`) and process updates in concurrency-limited chunks (e.g., using `Promise.all` with a chunking loop).

## 2025-02-18 - SQLite Batch Updates
**Learning:** SQLite performance for bulk updates is heavily dependent on transaction overhead. Updating items one-by-one in a loop creates implicit transactions for each update, which is slow.
**Action:** Wrap multiple update statements in a single `db.transaction` (batching) to significantly reduce I/O overhead and increase throughput.

## 2025-05-23 - Batch Transaction Optimization
**Learning:** Performing multiple inserts/updates in a loop without a transaction causes significant I/O overhead due to repeated fsyncs.
**Action:** Encapsulate bulk synchronization logic (like syncing indexers) within a single `db.transaction` in the storage layer, and pre-fetch existing records to avoid N+1 read queries.

## 2025-05-24 - Streaming Batch Processing
**Learning:** Fetching all external data upfront for a large dataset (e.g., 5000 games) causes high peak memory usage and potential timeouts before any processing begins.
**Action:** Move data fetching inside the processing loop (chunked) to "stream" the process. This keeps memory usage low and constant, regardless of dataset size.
