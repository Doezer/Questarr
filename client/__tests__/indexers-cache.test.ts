import { describe, expect, it, vi } from "vitest";
import { refreshIndexerQueries } from "../src/lib/indexers-cache";

describe("refreshIndexerQueries", () => {
  it("invalidates both indexer query caches", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshIndexerQueries({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["/api/indexers"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["/api/indexers/enabled"],
    });
  });

  it("propagates invalidation failures", async () => {
    const invalidateQueries = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cache failure"));

    await expect(refreshIndexerQueries({ invalidateQueries })).rejects.toThrow("cache failure");
  });
});
