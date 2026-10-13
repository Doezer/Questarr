// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth";

const mockSetLocation = vi.fn();
const mockToast = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function findMeCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find((call) => String(call[0]) === "/api/auth/me");
}

/** All /api/auth/me calls the mock fetch has recorded so far, in order. */
function findMeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/auth/me");
}

describe("AuthProvider — legacy localStorage token migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a pre-existing localStorage token into an in-memory bearer session and scrubs localStorage immediately", async () => {
    localStorage.setItem("token", "legacy-token");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") return jsonResponse(200, { id: "1", username: "admin" });
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <AuthProvider>
          <div>test</div>
        </AuthProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(findMeCall(fetchMock)).toBeDefined();
    });

    // Scrubbed from localStorage by the time /api/auth/me is requested.
    expect(localStorage.getItem("token")).toBeNull();

    // The legacy token was carried forward as an in-memory bearer header for
    // this request, so an already-logged-in user isn't stranded.
    const meCall = findMeCall(fetchMock)!;
    const headers = new Headers((meCall[1] as RequestInit | undefined)?.headers);
    expect(headers.get("Authorization")).toBe("Bearer legacy-token");
  });

  it("never writes a token to localStorage on a fresh (non-legacy) load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") return jsonResponse(401, {});
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <AuthProvider>
          <div>test</div>
        </AuthProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(findMeCall(fetchMock)).toBeDefined();
    });

    expect(localStorage.getItem("token")).toBeNull();
  });

  it("clears the in-memory bearer session on a 401 from /api/auth/me", async () => {
    localStorage.setItem("token", "legacy-token");

    // Record the Authorization header seen on every /api/auth/me call here,
    // rather than asserting inside the mock itself -- an assertion thrown
    // from within the fetch mock becomes a rejected fetch promise, which
    // TanStack Query treats as an ordinary network error, silently
    // swallowing the assertion failure instead of failing the test.
    const observedAuthHeaders: (string | null)[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") {
        const headers = new Headers(init?.headers);
        observedAuthHeaders.push(headers.get("Authorization"));
        // First call: the legacy bearer session, which the server rejects.
        return jsonResponse(401, {});
      }
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <AuthProvider>
          <div>test</div>
        </AuthProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(findMeCall(fetchMock)).toBeDefined();
    });

    expect(observedAuthHeaders[0]).toBe("Bearer legacy-token");
    // Any call after the bearer session was cleared must not carry the
    // (now-cleared) Authorization header.
    for (const header of observedAuthHeaders.slice(1)) {
      expect(header).toBeNull();
    }
  });

  it("keeps the in-memory bearer session across a transient network failure (doesn't require re-reading localStorage)", async () => {
    localStorage.setItem("token", "legacy-token");
    let meCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") {
        meCallCount++;
        throw new TypeError("Network error");
      }
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <AuthProvider>
          <div>test</div>
        </AuthProvider>
      </Wrapper>
    );

    await waitFor(
      () => {
        expect(meCallCount).toBeGreaterThan(1);
      },
      { timeout: 9000, interval: 100 }
    );

    // Still carrying the bearer header on every retry, not just the first.
    const meCalls = findMeCalls(fetchMock);
    expect(meCalls.length).toBeGreaterThan(1);
    for (const call of meCalls) {
      const headers = new Headers((call[1] as RequestInit | undefined)?.headers);
      expect(headers.get("Authorization")).toBe("Bearer legacy-token");
    }
  }, 12000);

  it("scrubs localStorage only after commit, never during render", async () => {
    localStorage.setItem("token", "legacy-token");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") return jsonResponse(200, { id: "1", username: "admin" });
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // A sibling's layout effect runs at commit, after every render-phase call
    // of AuthProvider and before any passive effect. A removal observed
    // before it would therefore have happened during render.
    let committed = false;
    function CommitMarker() {
      React.useLayoutEffect(() => {
        committed = true;
      }, []);
      return null;
    }

    const committedAtRemoval: boolean[] = [];
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key === "token") committedAtRemoval.push(committed);
    });

    render(
      <Wrapper>
        <AuthProvider>
          <div>test</div>
        </AuthProvider>
        <CommitMarker />
      </Wrapper>
    );

    await waitFor(() => {
      expect(findMeCall(fetchMock)).toBeDefined();
    });

    expect(committedAtRemoval).toEqual([true]);
    removeSpy.mockRestore();
  });

  it("keeps the migrated bearer token under React.StrictMode double invocation and migrates once", async () => {
    localStorage.setItem("token", "legacy-token");
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") return jsonResponse(200, { id: "1", username: "admin" });
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <React.StrictMode>
        <Wrapper>
          <AuthProvider>
            <div>test</div>
          </AuthProvider>
        </Wrapper>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(findMeCalls(fetchMock).length).toBeGreaterThan(0);
    });

    for (const call of findMeCalls(fetchMock)) {
      const headers = new Headers((call[1] as RequestInit | undefined)?.headers);
      expect(headers.get("Authorization")).toBe("Bearer legacy-token");
    }
    expect(localStorage.getItem("token")).toBeNull();
    expect(removeSpy.mock.calls.filter((c) => c[0] === "token").length).toBeLessThanOrEqual(2);
    removeSpy.mockRestore();
  });

  it("loads cookie-only sessions without an Authorization header", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/status") return jsonResponse(200, { hasUsers: true });
      if (url === "/api/auth/me") return jsonResponse(200, { id: "1", username: "admin" });
      throw new Error(`Unhandled URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <React.StrictMode>
        <Wrapper>
          <AuthProvider>
            <div>test</div>
          </AuthProvider>
        </Wrapper>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(findMeCall(fetchMock)).toBeDefined();
    });
    const headers = new Headers((findMeCall(fetchMock)![1] as RequestInit | undefined)?.headers);
    expect(headers.get("Authorization")).toBeNull();
  });
});
