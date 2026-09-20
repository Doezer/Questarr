// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { IgdbHelpPopover, IgdbTestConnectionButton } from "../components/IgdbCredentialsHelper";
import * as queryClientLib from "@/lib/queryClient";

vi.mock("@/lib/queryClient", async () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }
  return {
    apiRequest: vi.fn(),
    ApiError,
  };
});

describe("IgdbHelpPopover", () => {
  it("opens the popover and copies the redirect URI to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<IgdbHelpPopover />);

    fireEvent.click(screen.getByRole("button", { name: "How to get credentials" }));
    await waitFor(() => {
      expect(screen.getByText("How to get IGDB credentials:")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy redirect URI" }));

    expect(writeText).toHaveBeenCalledWith("http://localhost");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy redirect URI" })).toHaveTextContent("Copied");
    });
  });

  it("explains why Questarr can't ship a working credential out of the box", async () => {
    render(<IgdbHelpPopover />);
    fireEvent.click(screen.getByRole("button", { name: "How to get credentials" }));

    await waitFor(() => {
      expect(screen.getByText(/Twitch requires every/i)).toBeInTheDocument();
    });
  });
});

describe("IgdbTestConnectionButton", () => {
  const mockApiRequest = queryClientLib.apiRequest as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled until both credential fields are filled", () => {
    const { rerender } = render(
      <IgdbTestConnectionButton clientId="" clientSecret="" testEndpoint="/api/test" />
    );
    expect(screen.getByRole("button", { name: /test connection/i })).toBeDisabled();

    rerender(<IgdbTestConnectionButton clientId="abc" clientSecret="" testEndpoint="/api/test" />);
    expect(screen.getByRole("button", { name: /test connection/i })).toBeDisabled();

    rerender(
      <IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />
    );
    expect(screen.getByRole("button", { name: /test connection/i })).toBeEnabled();
  });

  it("shows a success message when the server reports success", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ success: true }),
    } as Response);

    render(<IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText("Connected successfully.")).toBeInTheDocument();
    });
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/test", {
      clientId: "abc",
      clientSecret: "def",
    });
  });

  it("shows the server's error message from a resolved { success: false } body", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ success: false, error: "Client Secret is required" }),
    } as Response);

    render(<IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText("Client Secret is required")).toBeInTheDocument();
    });
  });

  it("shows the server's specific error message from a thrown ApiError", async () => {
    const { ApiError } = queryClientLib as unknown as {
      ApiError: new (status: number, message: string) => Error;
    };
    mockApiRequest.mockRejectedValue(new ApiError(400, "Invalid Client ID or Client Secret."));

    render(<IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid Client ID or Client Secret.")).toBeInTheDocument();
    });
  });

  it("falls back to a generic message for a non-ApiError failure", async () => {
    mockApiRequest.mockRejectedValue(new Error("network down"));

    render(<IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not reach the server to test the connection.")
      ).toBeInTheDocument();
    });
  });

  it("resets the result and ignores a stale in-flight response when credentials change mid-request", async () => {
    let resolveFirst: (value: { json: () => Promise<unknown> }) => void;
    mockApiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    const { rerender } = render(
      <IgdbTestConnectionButton clientId="abc" clientSecret="def" testEndpoint="/api/test" />
    );
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(screen.getByText(/testing/i)).toBeInTheDocument();

    // Edit a credential while the first request is still in flight.
    rerender(
      <IgdbTestConnectionButton clientId="edited" clientSecret="def" testEndpoint="/api/test" />
    );

    // Now let the stale first request resolve with a success payload.
    resolveFirst!({ json: async () => ({ success: true }) });
    await new Promise((r) => setTimeout(r, 0));

    // The stale "Connected successfully." must not appear for the edited, untested credentials.
    expect(screen.queryByText("Connected successfully.")).not.toBeInTheDocument();
  });
});
