/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AddDdlLinksDialog from "../src/components/AddDdlLinksDialog";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const json = (body: unknown) => ({ json: async () => body }) as Response;

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddDdlLinksDialog game={{ id: "g1", title: "Some Game" }} open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  return onOpenChange;
}

beforeEach(() => {
  apiRequest.mockReset();
  toast.mockReset();
});

describe("AddDdlLinksDialog", () => {
  it("counts the links found and keeps the buttons disabled until there are some", () => {
    renderDialog();
    expect(screen.getByTestId("button-ddl-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-ddl-links"), {
      target: { value: "https://host.example/a\nhttps://host.example/b\nhttps://host.example/a" },
    });
    expect(screen.getByText("2 links found")).toBeInTheDocument();
    expect(screen.getByTestId("button-ddl-send")).toBeEnabled();
  });

  it("shows the health of each link after a check", async () => {
    apiRequest.mockResolvedValue(
      json({
        links: [
          { link: "https://host.example/a", supported: true, filename: "a.rar", filesize: 4194304 },
          { link: "https://nope.example/x", supported: false, error: "Host not supported" },
        ],
      })
    );
    renderDialog();
    fireEvent.change(screen.getByTestId("input-ddl-links"), {
      target: { value: "https://host.example/a https://nope.example/x" },
    });
    fireEvent.click(screen.getByTestId("button-ddl-check"));
    expect(await screen.findByText(/a\.rar/)).toBeInTheDocument();
    expect(screen.getByText(/Host not supported/)).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/games/g1/ddl/check",
      expect.objectContaining({ links: expect.stringContaining("host.example/a") })
    );
  });

  it("sends the links with the archive password and closes", async () => {
    apiRequest.mockResolvedValue(json({ success: true, links: 1 }));
    const onOpenChange = renderDialog();
    fireEvent.change(screen.getByTestId("input-ddl-links"), {
      target: { value: "https://host.example/a" },
    });
    fireEvent.change(screen.getByTestId("input-ddl-password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("button-ddl-send"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games/g1/ddl/links", {
      links: "https://host.example/a",
      archivePassword: "pw",
    });
  });
});
