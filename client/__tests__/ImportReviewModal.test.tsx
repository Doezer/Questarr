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
      data: { transferMode: "move", libraryRoot: "/games/library" },
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

  it("prefills the saved library root and opens the browser there", () => {
    render(
      <ImportReviewModal
        open
        onOpenChange={vi.fn()}
        downloadId="download-1"
        downloadTitle="Test Download"
      />
    );

    expect(screen.getByLabelText("Destination Path")).toHaveValue("/games/library");

    fireEvent.click(screen.getByRole("button", { name: "Browse destination directories" }));

    const lastCall = mockFileBrowser.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      open: true,
      initialPath: "/games/library",
      root: "/",
      title: "Select Destination",
    });
  });

  describe("password-protected archives", () => {
    it("shows the password prompt, pre-enables Unpack Archive, and requires a password to confirm", () => {
      render(
        <ImportReviewModal
          open
          onOpenChange={vi.fn()}
          downloadId="download-1"
          downloadTitle="Encrypted.rar"
          passwordRequired
        />
      );

      expect(screen.getByText("Password Required")).toBeInTheDocument();
      const passwordField = screen.getByLabelText("Archive Password");
      expect(passwordField).toBeInTheDocument();

      // Unpack Archive is forced on and locked while a password is required.
      expect(screen.getByRole("switch")).toBeChecked();
      expect(screen.getByRole("switch")).toBeDisabled();

      // Destination path is pre-filled from importConfig, so the only missing
      // requirement is the password — confirming without one should be blocked.
      fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Validation Error",
          description: expect.stringContaining("password-protected"),
        })
      );
    });

    it("does not show a password field or title when the archive isn't password-protected", () => {
      render(
        <ImportReviewModal
          open
          onOpenChange={vi.fn()}
          downloadId="download-1"
          downloadTitle="Test Download"
        />
      );

      expect(screen.queryByText("Password Required")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Archive Password/)).not.toBeInTheDocument();
    });
  });
});
