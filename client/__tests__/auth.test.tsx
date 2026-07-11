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
vi.mock("@/lib/queryClient", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
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

  it("clears the token when /api/auth/me returns 401", async () => {
    localStorage.setItem("token", "stale-token");
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/status")) return jsonResponse(200, { hasUsers: true });
      if (url.includes("/api/auth/me")) return jsonResponse(401, {});
      return jsonResponse(404, {});
    });

    renderAuth(createClient());

    await waitFor(() => {
      expect(localStorage.getItem("token")).toBeNull();
    });
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

  it("login mutates state, stores the token, and navigates home", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ token: "new-token", user: { id: "u1", username: "newuser" } }),
    });

    renderAuth(createClient());
    await waitFor(() => screen.getByTestId("user"));

    await act(async () => {
      screen.getByRole("button", { name: "Login" }).click();
    });

    await waitFor(() => {
      expect(localStorage.getItem("token")).toBe("new-token");
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Logged in successfully" })
    );
    expect(setLocationMock).toHaveBeenCalledWith("/");
  });

  it("shows an error toast when login fails", async () => {
    mockApiRequest.mockRejectedValue(new Error("Invalid credentials"));

    renderAuth(createClient());
    await waitFor(() => screen.getByTestId("user"));

    await act(async () => {
      screen.getByRole("button", { name: "Login" }).click();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Login failed", variant: "destructive" })
      );
    });
  });

  it("logout clears the token and redirects to /login", async () => {
    localStorage.setItem("token", "existing-token");
    renderAuth(createClient());
    await waitFor(() => screen.getByTestId("user"));

    await act(async () => {
      screen.getByRole("button", { name: "Logout" }).click();
    });

    expect(localStorage.getItem("token")).toBeNull();
    expect(setLocationMock).toHaveBeenCalledWith("/login");
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
