/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import Library from "../src/components/Library";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-hidden-mutation", () => ({
  useHiddenMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-download-summary", () => ({
  useDownloadSummary: () => ({}),
}));

vi.mock("@/hooks/use-view-controls", () => ({
  useViewControls: () => ({
    viewMode: "grid",
    setViewMode: vi.fn(),
    listDensity: "comfortable",
    setListDensity: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-local-storage-state", () => ({
  useLocalStorageState: (_key: string, initial: number | boolean) => React.useState(initial),
}));

vi.mock("@/components/GameFilterPills", () => ({
  default: () => <div data-testid="library-filter-pills" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const response = await fetch(queryKey.join(""));
          if (!response.ok) throw new Error("Network response was not ok");
          return response.json();
        },
      },
    },
  });

describe("Library mobile toolbar", () => {
  it("renders mobile filter pills and the filter tooltip label", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as never;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Library />
      </QueryClientProvider>
    );

    expect(await screen.findAllByTestId("library-filter-pills")).toHaveLength(2);
    expect(screen.getAllByText("Filters").length).toBeGreaterThan(0);
  });
});
