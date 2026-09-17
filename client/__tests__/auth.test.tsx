/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const setLocationMock = vi.fn();
let currentLocation = "/";
vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, setLocationMock],
}));

const mockApiFetch = vi.fn();
const mockApiRequest = vi.fn();
const mockSetBearerToken = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setBearerToken: (...args: unknown[]) => mockSetBearerToken(...args),
}));

import { AuthProvider, useAuth } from "../src/lib/auth";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function TestConsumer() {
  const { user, isLoading, needsSetup, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="needs-setup">{String(needsSetup)}</div>
      <div data-testid="user">{user ? user.username : "none"}</div>
      <button onClick={() => login({ username: "a", password: "b" }).catch(() => {})}>Login</button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

function renderAuth(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentLocation = "/";
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) return jsonResponse(200, null);
      return jsonResponse(404, {});
    });
    // logout() calls apiRequest("POST", "/api/auth/logout") best-effort; give
    // it a sane default so tests that don't care about that call directly
    // don't have to configure it themselves.
    mockApiRequest.mockResolvedValue(jsonResponse(200, { success: true }));
  });

  it("redirects to /setup when no users exist yet", async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: false });
      return jsonResponse(200, null);
    });

    renderAuth(createClient());

    await waitFor(() => {
      expect(screen.getByTestId("needs-setup")).toHaveTextContent("true");
    });
    await waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith("/setup");
    });
  });

  it("redirects to /login when setup is complete and the user is unauthenticated", async () => {
    renderAuth(createClient());

    await waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith("/login");
    });
  });

  it("does not redirect when already on /login", async () => {
    currentLocation = "/login";
    renderAuth(createClient());

    await waitFor(() => {
      expect(screen.getByTestId("needs-setup")).toHaveTextContent("false");
    });
    expect(setLocationMock).not.toHaveBeenCalledWith("/login");
  });

  it("does not redirect when already on /setup", async () => {
    currentLocation = "/setup";
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: false });
      return jsonResponse(200, null);
    });
    renderAuth(createClient());

    await waitFor(() => {
      expect(screen.getByTestId("needs-setup")).toHaveTextContent("true");
    });
    expect(setLocationMock).not.toHaveBeenCalledWith("/setup");
  });

  it("loads the authenticated user from /api/auth/me when a token exists", async () => {
    localStorage.setItem("token", "existing-token");
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) {
        return jsonResponse(200, { id: "u1", username: "tester" });
      }
      return jsonResponse(404, {});
    });

    renderAuth(createClient());

    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("tester");
    });
  });

  it("clears the in-memory bearer session when /api/auth/me returns 401", async () => {
    localStorage.setItem("token", "stale-token");
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) return jsonResponse(401, {});
      return jsonResponse(404, {});
    });

    renderAuth(createClient());

    // Migrated once synchronously on mount (with the legacy token)...
    await waitFor(() => {
      expect(mockSetBearerToken).toHaveBeenCalledWith("stale-token");
    });
    // ...then cleared once the server rejects it.
    await waitFor(() => {
      expect(mockSetBearerToken).toHaveBeenCalledWith(null);
    });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("does not wipe the cached /api/auth/status query when /api/auth/me returns 401", async () => {
    // A prior bug cleared the *entire* QueryClient here, which could cancel
    // the still-in-flight /api/auth/status query and strand its observers
    // (setup/config screens) on an indefinite loading state.
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) return jsonResponse(401, {});
      return jsonResponse(404, {});
    });
    const client = createClient();

    renderAuth(client);

    await waitFor(() => {
      expect(client.getQueryData(["/api/auth/status"])).toEqual({ hasUsers: true });
    });
    // Cache survives the /api/auth/me 401 handling.
    expect(client.getQueryData(["/api/auth/status"])).toEqual({ hasUsers: true });
  });

  it("redirects to / when authenticated and sitting on /login", async () => {
    currentLocation = "/login";
    localStorage.setItem("token", "existing-token");
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) {
        return jsonResponse(200, { id: "u1", username: "tester" });
      }
      return jsonResponse(404, {});
    });

    renderAuth(createClient());

    await waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith("/");
    });
  });

  it("login mutates state and navigates home without touching localStorage (cookies carry the session)", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ token: "new-token", user: { id: "u1", username: "newuser" } }),
    });

    renderAuth(createClient());
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      screen.getByRole("button", { name: "Login" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("newuser");
    });
    // The server has already set the httpOnly auth cookie; the client never
    // persists the token returned in the body (kept only for backward
    // compatibility with non-browser bearer clients).
    expect(localStorage.getItem("token")).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Logged in successfully" })
    );
    expect(setLocationMock).toHaveBeenCalledWith("/");
  });

  it("clears a stale migrated bearer token on successful login, so it can't override the fresh cookie", async () => {
    // A stale bearer token (migrated from a pre-cookie session) takes
    // priority over the auth cookie on every request server-side. If login
    // left it in place, a fresh valid cookie session would keep getting
    // silently rejected in favor of the stale bearer on every subsequent
    // /api/auth/me check.
    localStorage.setItem("token", "stale-legacy-token");
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) return jsonResponse(401, {});
      return jsonResponse(404, {});
    });
    mockApiRequest.mockResolvedValue({
      json: async () => ({ token: "new-token", user: { id: "u1", username: "newuser" } }),
    });

    renderAuth(createClient());

    // Migrated on mount.
    await waitFor(() => {
      expect(mockSetBearerToken).toHaveBeenCalledWith("stale-legacy-token");
    });

    await act(async () => {
      screen.getByRole("button", { name: "Login" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("newuser");
    });
    // The last call must be the clear, not a stale re-set of the migrated token.
    expect(mockSetBearerToken).toHaveBeenLastCalledWith(null);
  });

  it("shows an error toast when login fails", async () => {
    mockApiRequest.mockRejectedValue(new Error("Invalid credentials"));

    renderAuth(createClient());
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      screen.getByRole("button", { name: "Login" }).click();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Login failed", variant: "destructive" })
      );
    });
  });

  it("logout clears the in-memory bearer session, best-effort calls the logout endpoint, and redirects to /login", async () => {
    renderAuth(createClient());
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      screen.getByRole("button", { name: "Logout" }).click();
    });

    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/logout");
    expect(mockSetBearerToken).toHaveBeenCalledWith(null);
    expect(localStorage.getItem("token")).toBeNull();
    expect(setLocationMock).toHaveBeenCalledWith("/login");
  });

  it("leaves local session state alone and shows an error toast when the server-side logout call fails", async () => {
    mockApiRequest.mockRejectedValue(new Error("network down"));

    renderAuth(createClient());
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    // Mount-time migration already calls setBearerToken(null) once (no
    // legacy token in this test) -- clear that call so the assertions below
    // are only about what logout() itself does.
    mockSetBearerToken.mockClear();
    setLocationMock.mockClear();

    await act(async () => {
      screen.getByRole("button", { name: "Logout" }).click();
      // Let the rejected apiRequest promise settle before asserting.
      await Promise.resolve();
    });

    // A failed server-side logout means the httpOnly session cookie is
    // still live server-side -- clearing local state anyway would make the
    // client silently believe it logged out when it didn't.
    expect(mockSetBearerToken).not.toHaveBeenCalled();
    expect(setLocationMock).not.toHaveBeenCalledWith("/login");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Logout failed", variant: "destructive" })
    );
  });

  it("useAuth throws when used outside an AuthProvider", () => {
    function Broken() {
      useAuth();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Broken />)).toThrow("useAuth must be used within an AuthProvider");
    spy.mockRestore();
  });
});
