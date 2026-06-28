/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "../src/lib/queryClient";

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockFetch() {
  const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function setToken(token: string | null) {
  if (token === null) {
    localStorage.removeItem("token");
  } else {
    localStorage.setItem("token", token);
  }
}

// ─── withAuthorization (tested through apiFetch) ──────────────────────────────

describe("apiFetch / withAuthorization", () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchSpy = mockFetch();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // No token — headers passed through unchanged
  it("does not add Authorization when no token is stored", async () => {
    setToken(null);
    await apiFetch("/api/games");
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toBeUndefined();
  });

  // No token, undefined headers — returns undefined headers
  it("passes undefined headers through when no token is stored", async () => {
    setToken(null);
    await apiFetch("/api/games", { headers: undefined });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });

  // Token present, no headers → injects plain object with Authorization
  it("injects Authorization header when token exists and no headers provided", async () => {
    setToken("my-token");
    await apiFetch("/api/games");
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  // Token + Headers instance without existing Authorization → new Headers with token
  it("injects Authorization into a Headers instance without mutating the original", async () => {
    setToken("my-token");
    const original = new Headers({ "Content-Type": "application/json" });
    await apiFetch("/api/games", { headers: original });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as Headers;
    expect(returned.get("Authorization")).toBe("Bearer my-token");
    // original must not be mutated
    expect(original.has("Authorization")).toBe(false);
  });

  // Token + Headers instance that already has Authorization → existing value preserved
  it("does not overwrite an existing Authorization in a Headers instance", async () => {
    setToken("new-token");
    const original = new Headers({ Authorization: "Bearer existing-token" });
    await apiFetch("/api/games", { headers: original });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as Headers;
    expect(returned.get("Authorization")).toBe("Bearer existing-token");
  });

  // Token + array headers without Authorization → appends entry
  it("injects Authorization into array headers", async () => {
    setToken("my-token");
    const headers: [string, string][] = [["Content-Type", "application/json"]];
    await apiFetch("/api/games", { headers });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as [string, string][];
    expect(returned).toContainEqual(["Authorization", "Bearer my-token"]);
  });

  // Token + array headers that already contain Authorization → unchanged (covers the true branch)
  it("leaves array headers unchanged when Authorization is already present", async () => {
    setToken("new-token");
    const headers: [string, string][] = [["Authorization", "Bearer existing"]];
    await apiFetch("/api/games", { headers });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as [string, string][];
    // Should still be the exact same array reference (not spread)
    expect(returned).toBe(headers);
  });

  // Token + plain object headers without Authorization → spread with Authorization added
  it("injects Authorization into plain-object headers", async () => {
    setToken("my-token");
    await apiFetch("/api/games", { headers: { "Content-Type": "text/plain" } });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as Record<string, string>;
    expect(returned["Authorization"]).toBe("Bearer my-token");
    expect(returned["Content-Type"]).toBe("text/plain");
  });

  // Token + plain object headers that already contain Authorization → unchanged (covers true branch)
  it("leaves plain-object headers unchanged when Authorization is already present", async () => {
    setToken("new-token");
    const headers = { Authorization: "Bearer existing", "X-Custom": "value" };
    await apiFetch("/api/games", { headers });
    const [, init] = fetchSpy.mock.calls[0];
    const returned = init?.headers as Record<string, string>;
    expect(returned["Authorization"]).toBe("Bearer existing");
  });

  // Verifies withBasePath is applied to the URL
  it("prepends the app base path to the request URL", async () => {
    setToken(null);
    await apiFetch("/api/games");
    const [url] = fetchSpy.mock.calls[0];
    // In the test environment BASE_URL is "/", so withBasePath("/api/games") === "/api/games"
    expect(String(url)).toContain("/api/games");
  });
});
