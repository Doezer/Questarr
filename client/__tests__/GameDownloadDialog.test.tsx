/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameDownloadDialog from "../src/components/GameDownloadDialog"; // Adjust path as needed
import { Toaster } from "@/components/ui/toaster";

// Mocking external dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    toasts: [],
  }),
}));

vi.mock("lucide-react", () => ({
  Download: () => <div data-testid="icon-download" />,
  HardDrive: () => <div data-testid="icon-harddrive" />,
  Users: () => <div data-testid="icon-users" />,
  Calendar: () => <div data-testid="icon-calendar" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Search: () => <div data-testid="icon-search" />,
  Plus: () => <div />,
  Edit: () => <div />,
  Trash2: () => <div />,
  Check: () => <div />,
  X: () => <div />,
  Activity: () => <div />,
}));

const mockGame = {
  id: 1,
  title: "Test Game",
  // Add other necessary game properties here
};

const mockTorrents = {
  items: [
    {
      guid: "123",
      title: "Test Torrent 1",
      link: "http://test.com/torrent1",
      pubDate: new Date().toISOString(),
      size: 1024,
      seeders: 10,
      leechers: 2,
    },
  ],
  total: 1,
  offset: 0,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Mock fetch
global.fetch = vi.fn();

const renderComponent = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <GameDownloadDialog game={mockGame} open={true} onOpenChange={() => {}} />
      <Toaster />
    </QueryClientProvider>
  );
};

describe("GameDownloadDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient.setQueryData(["/api/search?query=Test%20Game"], mockTorrents);

    // Mock successful search query
    global.fetch = vi.fn(async (url) => {
      console.log("Fetching URL:", url);
      if (url.toString().includes("/api/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTorrents,
        });
      }
      if (url.toString().includes("/api/downloads")) {
        // Add a delay to ensure loading state is visible
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, downloaderName: "TestDownloader" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  });

  it("shows a loading spinner on the specific download button when clicked", async () => {
    renderComponent();

    // Wait for torrents to be loaded and displayed
    const downloadButton = await screen.findByRole("button", { name: /Download/i });
    expect(downloadButton).toBeInTheDocument();

    // Click the download button
    fireEvent.click(downloadButton);

    // After clicking, the button should show a loading state
    await waitFor(() => {
      // Check for the spinner element by test id and disabled state
      const spinner = screen.getByTestId("icon-loader");
      expect(spinner).toBeInTheDocument();
      // The button containing the spinner should be disabled
      const button = spinner.closest("button");
      expect(button).toBeDisabled();
    });
  });
});
