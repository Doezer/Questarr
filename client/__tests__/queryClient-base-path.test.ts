/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "../src/lib/queryClient";

// Regression coverage for #925: CodeRabbit correctly flagged that the
// server-side base-path mounting test (server/__tests__/api_routes.test.ts)
// doesn't prove the *client* actually reaches the prefixed URL -- a call
// site regressing back to raw fetch() (bypassing apiFetch/withBasePath)
// would slip past it. Mock app-path's withBasePath the way it behaves when
// QUESTARR_BASE_PATH is configured, and assert apiFetch honors it for the
// exact endpoint from the issue.
vi.mock("@/lib/app-path", () => ({
  withBasePath: (path: string) => `/Questarr${path}`,
}));

describe("apiFetch under a configured base path", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes /api/igdb/search with the configured base path", async () => {
    await apiFetch("/api/igdb/search?q=Zelda");
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/Questarr/api/igdb/search?q=Zelda");
  });
});
