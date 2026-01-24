// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import SetupPage from "../pages/auth/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as auth from "@/lib/auth";
import * as toastHook from "@/hooks/use-toast";
import * as queryClientLib from "@/lib/queryClient";

// Mocks
vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
  };
});

// Mock wouter location
vi.mock("wouter", () => ({
  useLocation: () => ["/setup", vi.fn()],
}));

// Setup QueryClient
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe("SetupPage", () => {
  let queryClient: QueryClient;
  const mockCheckSetup = vi.fn();
  const mockToast = vi.fn();
  const mockApiRequest = queryClientLib.apiRequest as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();

    (auth.useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      checkSetup: mockCheckSetup,
    });

    (toastHook.useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: mockToast,
    });

    // Mock successful login response by default
    mockApiRequest.mockResolvedValue({
      json: async () => ({ token: "fake-token", user: { id: "1", username: "admin" } }),
    } as Response);
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <SetupPage />
      </QueryClientProvider>
    );
  };

  it("submits form successfully without IGDB fields when IGDB is already configured", async () => {
    // Mock config as configured
    mockApiRequest.mockImplementation((method, url) => {
      if (url === "/api/config") {
        return Promise.resolve({
          json: async () => ({ igdb: { configured: true } }),
        } as Response);
      }
      if (url === "/api/auth/setup") {
        return Promise.resolve({
          json: async () => ({ token: "fake-token", user: { id: "1", username: "admin" } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderComponent();

    // Wait for config to load and verify IGDB fields are NOT present
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/config");
      expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    });

    // Fill form
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    // Verify API call
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/setup", {
        username: "admin",
        password: "password123",
        igdbClientId: "",
        igdbClientSecret: "",
      });
    });
  });

  it("requires IGDB fields when IGDB is NOT configured", async () => {
    // Mock config as NOT configured
    mockApiRequest.mockImplementation((method, url) => {
      if (url === "/api/config") {
        return Promise.resolve({
          json: async () => ({ igdb: { configured: false } }),
        } as Response);
      }
      return Promise.resolve({
        json: async () => ({}),
      } as Response);
    });

    renderComponent();

    // Wait for config to load and verify IGDB fields ARE present
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/config");
      expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    });

    // Fill only user fields
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    // Should verify that API was NOT called (validation error)
    await waitFor(() => {
      expect(screen.getByText(/IGDB Client ID is required/i)).toBeInTheDocument();
    });
    expect(mockApiRequest).not.toHaveBeenCalledWith("POST", "/api/auth/setup", expect.anything());

    // Fill IGDB fields
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: "client_id" } });
    fireEvent.change(screen.getByLabelText(/client secret/i), {
      target: { value: "client_secret" },
    });

    // Submit again
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    // Verify API call
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/setup", {
        username: "admin",
        password: "password123",
        igdbClientId: "client_id",
        igdbClientSecret: "client_secret",
      });
    });
  });
});
