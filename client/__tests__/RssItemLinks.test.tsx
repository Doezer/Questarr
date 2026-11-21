import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RssItemLinks from "@/components/RssItemLinks";
import type { RssFeedItem } from "@shared/schema";

vi.mock("@/components/AddDdlLinksDialog", () => ({ default: () => null }));

const item = (overrides: Partial<RssFeedItem>) =>
  ({
    id: "i1",
    title: "Game",
    igdbGameId: 7,
    links: ["https://1fichier.com/?a", "https://1fichier.com/?b"],
    ...overrides,
  }) as RssFeedItem;

function renderWith(data: Record<string, unknown>, rssItem: RssFeedItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, value] of Object.entries(data)) client.setQueryData([key], value);
  return render(
    <QueryClientProvider client={client}>
      <RssItemLinks item={rssItem} />
    </QueryClientProvider>
  );
}

describe("RssItemLinks", () => {
  it("renders nothing for an item without links", () => {
    const { container } = renderWith({}, item({ links: null }));
    expect(container).toBeEmptyDOMElement();
  });

  it("is enabled when the game is in the library and Real-Debrid is set up", () => {
    renderWith(
      {
        "/api/games": [{ id: "g1", title: "Game", igdbId: 7 }],
        "/api/downloaders/enabled": [{ id: "d", type: "realdebrid" }],
      },
      item({})
    );
    expect(screen.getByTestId("button-rss-links-i1")).toBeEnabled();
    expect(screen.getByText("2 links")).toBeInTheDocument();
  });

  it("is disabled when the matched game is not in the library", () => {
    renderWith(
      { "/api/games": [], "/api/downloaders/enabled": [{ id: "d", type: "realdebrid" }] },
      item({})
    );
    expect(screen.getByTestId("button-rss-links-i1")).toBeDisabled();
  });
});
