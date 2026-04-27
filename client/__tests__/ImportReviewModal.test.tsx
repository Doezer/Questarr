/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportReviewModal from "../src/components/ImportReviewModal";

const { mockInvalidateQueries, mockToast, mockFileBrowser } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockToast: vi.fn(),
  mockFileBrowser: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: { transferMode: "move" },
      isLoading: false,
      error: null,
    }),
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("../src/components/FileBrowser", () => ({
  FileBrowser: (props: Record<string, unknown>) => {
    mockFileBrowser(props);
    return null;
  },
}));

describe("ImportReviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the destination browser from filesystem root", () => {
    render(
      <ImportReviewModal
        open
        onOpenChange={vi.fn()}
        downloadId="download-1"
        downloadTitle="Test Download"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse destination directories" }));

    const lastCall = mockFileBrowser.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      open: true,
      initialPath: "/",
      root: "/",
      title: "Select Destination",
    });
  });
});
