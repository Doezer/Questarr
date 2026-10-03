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

  const fillAccountFields = () => {
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });
  };

  it("submits form successfully without a key field when RAWG is already configured", async () => {
    mockApiRequest.mockImplementation((_method, url) => {
      if (url === "/api/auth/status") {
        return Promise.resolve({
          json: async () => ({ rawg: { configured: true } }),
        } as Response);
      }
      if (url === "/api/auth/setup") {
        return Promise.resolve({
          json: async () => ({ token: "fake-token", user: { id: "1", username: "admin" } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupPage />
      </QueryClientProvider>
    );

    // Wait for the status to load and verify the key field is NOT present.
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/auth/status");
      expect(screen.queryByLabelText(/^api key$/i)).not.toBeInTheDocument();
    });

    fillAccountFields();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/setup", {
        username: "admin",
        password: "password123",
        rawgApiKey: "",
      });
    });
  }, 10000);

  it("requires a RAWG API key when RAWG is not configured", async () => {
    mockApiRequest.mockImplementation((_method, url) => {
      if (url === "/api/auth/status") {
        return Promise.resolve({
          json: async () => ({ rawg: { configured: false } }),
        } as Response);
      }
      return Promise.resolve({
        json: async () => ({}),
      } as Response);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupPage />
      </QueryClientProvider>
    );

    // Wait for the status to load and verify the RAWG key field is present.
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/auth/status");
      expect(screen.getByLabelText(/^api key$/i)).toBeInTheDocument();
    });

    fillAccountFields();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    // Without a key the validation refine blocks the request.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockApiRequest).not.toHaveBeenCalledWith("POST", "/api/auth/setup", expect.anything());
    expect(screen.getByText("Enter a RAWG API key (free at rawg.io).")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^api key$/i), { target: { value: "rawg-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/setup", {
        username: "admin",
        password: "password123",
        rawgApiKey: "rawg-test-key",
      });
    });
  });

  it("tests the RAWG key through the unauthenticated test endpoint", async () => {
    mockApiRequest.mockImplementation((_method, url) => {
      if (url === "/api/auth/status") {
        return Promise.resolve({
          json: async () => ({ rawg: { configured: false } }),
        } as Response);
      }
      if (url === "/api/auth/setup/test-rawg") {
        return Promise.resolve({
          json: async () => ({ success: true }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupPage />
      </QueryClientProvider>
    );

    const keyInput = await screen.findByLabelText(/^api key$/i);
    expect(screen.getByRole("button", { name: /test rawg key/i })).toBeDisabled();

    fireEvent.change(keyInput, { target: { value: "rawg-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: /test rawg key/i }));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/setup/test-rawg", {
        apiKey: "rawg-test-key",
      });
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "RAWG connection successful" })
    );
  });

  it("does not crash when GET /api/auth/status returns { hasUsers: true } (no rawg field)", async () => {
    // Once setup is complete, /api/auth/status omits the provider fields
    // entirely (see server/routes.ts) -- a direct navigation to /setup racing
    // ahead of AuthProvider's own redirect must not crash this page while it
    // renders.
    mockApiRequest.mockImplementation((_method, url) => {
      if (url === "/api/auth/status") {
        return Promise.resolve({
          json: async () => ({ hasUsers: true }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/auth/status");
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    // rawg is absent, so the RAWG block renders with the key field, exactly
    // like the explicit "not configured" case. The regression this guards
    // against is a crash reading config.rawg.configured when rawg is undefined.
    await waitFor(() => {
      expect(screen.getByLabelText(/^api key$/i)).toBeInTheDocument();
    });
  });
});
