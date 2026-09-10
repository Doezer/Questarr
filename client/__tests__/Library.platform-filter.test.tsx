/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

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

// Render Select items inline so the dropdown contents can be asserted without
// driving Radix's portal/pointer behaviour.
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
    title: "Alpha",
    status: "owned",
    genres: ["RPG"],
    platforms: ["Nintendo Switch", "PC (Microsoft Windows)"],
    userRating: null,
    searchResultsAvailable: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Beta",
    status: "owned",
    genres: ["Action"],
    platforms: ["PlayStation 5"],
    userRating: null,
    searchResultsAvailable: false,
  },
];

const IGDB_PLATFORMS = [
  { id: 130, name: "Nintendo Switch" },
  { id: 6, name: "PC (Microsoft Windows)" },
  { id: 167, name: "PlayStation 5" },
];

function mockFetch(settings: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (u.includes("/api/games")) return { ok: true, json: async () => GAMES } as Response;
    if (u.includes("/api/settings")) return { ok: true, json: async () => settings } as Response;
    if (u.includes("/api/igdb/platforms"))
      return { ok: true, json: async () => IGDB_PLATFORMS } as Response;
    return { ok: true, json: async () => [] } as Response;
  }) as typeof fetch;
}

async function renderLibrary(settings: Record<string, unknown>) {
  mockFetch(settings);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Library />
    </QueryClientProvider>
  );
  fireEvent.click(await screen.findByRole("button", { name: /toggle filters/i }));
}

describe("Library platform filter visibility", () => {
  it("hides platforms selected in the hidden-platform setting", async () => {
    await renderLibrary({ hiddenPlatforms: ["Nintendo Switch"] });

    // Switch is hidden; the other platforms from the same library still show.
    expect(await screen.findByText("PC (Microsoft Windows)")).toBeInTheDocument();
    expect(screen.getByText("PlayStation 5")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Nintendo Switch")).not.toBeInTheDocument());
  });

  it("lists every library platform when nothing is hidden", async () => {
    await renderLibrary({ hiddenPlatforms: [] });

    expect(await screen.findByText("Nintendo Switch")).toBeInTheDocument();
    expect(screen.getByText("PC (Microsoft Windows)")).toBeInTheDocument();
    expect(screen.getByText("PlayStation 5")).toBeInTheDocument();
  });
});
