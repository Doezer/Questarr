import { describe, expect, it, vi } from "vitest";
import {
  beginStagingJob,
  cancelStagingJobs,
  setStagingBlocked,
  stagingJobs,
} from "../downloaders/debrid-staging.js";

describe("staging block after switching to link-only", () => {
  it("refuses new copies from stale callers until unblocked", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await cancelStagingJobs("dl-block");
    const job = beginStagingJob({
      downloaderId: "dl-block",
      id: "1",
      bytesTotal: 1,
      run,
      label: "T",
    });
    expect(run).not.toHaveBeenCalled();
    expect(job.cancelled).toBe(true);
    expect(stagingJobs.has("dl-block:1")).toBe(false);

    setStagingBlocked("dl-block", false);
    const next = beginStagingJob({
      downloaderId: "dl-block",
      id: "1",
      bytesTotal: 1,
      run,
      label: "T",
    });
    await next.done;
    expect(run).toHaveBeenCalledTimes(1);
    stagingJobs.clear();
  });
});
