/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Library from "../src/components/Library";
import { createTestQueryClient } from "./test-utils";

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
  useLocalStorageState: <T,>(_key: string, initial: T) => {
    const [value, setValue] = React.useState(initial);
    return [value, setValue] as const;
  },
}));

vi.mock("@/components/GameFilterPills", () => ({ default: () => <div /> }));
vi.mock("@/components/GameGrid", () => ({ default: () => <div data-testid="game-grid" /> }));
vi.mock("@/components/AddGameModal", () => ({ default: () => null }));
vi.mock("@/components/PendingImportsCard", () => ({ default: () => null }));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<(value: string) => void>(() => {});
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
    }) => <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

const GAMES = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Metroid Dread",
    status: "owned",
    genres: ["Platformer"],
    platforms: ["Nintendo Switch"],
    userRating: null,
    searchResultsAvailable: false,
  },
];

function mockFetch(hiddenPlatforms: unknown) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (u.includes("/api/games")) return { ok: true, json: async () => GAMES } as Response;
    if (u.includes("/api/settings")) {
      // Deliberately malformed: a JSON column can carry a non-array from a
      // legacy row or a bad PATCH. Spreading it would throw during render.
      return { ok: true, json: async () => ({ hiddenPlatforms }) } as Response;
    }
    if (u.includes("/api/igdb/platforms")) {
      return { ok: true, json: async () => [{ id: 130, name: "Nintendo Switch" }] } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  }) as typeof fetch;
}

describe("Library hidden-platform guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without crashing when hiddenPlatforms is a malformed non-array", async () => {
    mockFetch("oops");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Library />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /toggle filters/i }));

    // The dropdown still lists every library platform rather than throwing.
    expect(await screen.findByText("Nintendo Switch")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("game-grid")).toBeInTheDocument());
  });

  it("renders when hiddenPlatforms is a numeric non-array", async () => {
    mockFetch(42);
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Library />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /toggle filters/i }));

    expect(await screen.findByText("Nintendo Switch")).toBeInTheDocument();
  });
});
