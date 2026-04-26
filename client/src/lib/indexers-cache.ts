import type { QueryClient } from "@tanstack/react-query";

/**
 * Keeps indexer-dependent views in sync after indexer configuration changes.
 */
export async function refreshIndexerQueries(
  client: Pick<QueryClient, "invalidateQueries">
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["/api/indexers"] }),
    client.invalidateQueries({ queryKey: ["/api/indexers/enabled"] }),
  ]);
}
