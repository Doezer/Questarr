/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportReviewModal from "../src/components/ImportReviewModal";

const { mockInvalidateQueries, mockToast, mockFileBrowser, mockApiRequest } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockToast: vi.fn(),
  mockFileBrowser: vi.fn(),
  mockApiRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: mockApiRequest,
}));

// Real react-query's useMutation wraps mutationFn in an internal cache/state machine that
// makes onSuccess/onError hard to observe synchronously in a test. This mock instead runs
// mutationFn (and, on rejection, onError; on success, onSuccess) directly, so a test can
// fire the mutation and await the same options.mutationFn/onError the component wired up —
// exercising the same POST-body and toast-title logic actual use, without a QueryClient.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: { transferMode: "move", libraryRoot: "/games/library" },
      isLoading: false,
      error: null,
    }),
    useMutation: (options: {
      mutationFn: () => Promise<unknown>;
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    }) => ({
      mutate: () => {
        options
          .mutationFn()
          .then(() => options.onSuccess?.())
          .catch((error: unknown) => options.onError?.(error));
      },
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

// Shared by the password-submission tests below to avoid repeating the same
// render props / field-filling sequence in each one (SonarCloud flagged the
// un-factored version as duplicated new code).
function renderModal(props: Partial<React.ComponentProps<typeof ImportReviewModal>> = {}) {
  return render(
    <ImportReviewModal
      open
      onOpenChange={vi.fn()}
      downloadId="download-1"
      downloadTitle="Encrypted.rar"
      {...props}
    />
  );
}

function fillAndSubmitPassword(password: string): void {
  // Destination defaults to the bare library root, which the component's own
  // guard rejects ("must be a subfolder") — point it at a subfolder instead so
  // that guard doesn't short-circuit before the password path is exercised.
  fireEvent.change(screen.getByLabelText("Destination Path"), {
    target: { value: "/games/library/PC/Encrypted" },
  });
  fireEvent.change(screen.getByLabelText("Archive Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
}

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
      renderModal({ passwordRequired: true });

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
      renderModal({ downloadTitle: "Test Download" });

      expect(screen.queryByText("Password Required")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Archive Password/)).not.toBeInTheDocument();
    });

    it("submits the entered password and unpack:true when confirming", async () => {
      renderModal({ passwordRequired: true });
      fillAndSubmitPassword("hunter2");

      await waitFor(() =>
        expect(mockApiRequest).toHaveBeenCalledWith(
          "POST",
          "/api/imports/download-1/confirm",
          expect.objectContaining({ unpack: true, password: "hunter2" })
        )
      );
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Import Confirmed" })
        )
      );
    });

    it("shows an Incorrect Password toast when the confirm request rejects with passwordRequired", async () => {
      mockApiRequest.mockRejectedValueOnce(
        Object.assign(new Error("The provided password was rejected — it may be incorrect."), {
          data: { passwordRequired: true },
        })
      );

      renderModal({ passwordRequired: true });
      fillAndSubmitPassword("wrongpass");

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Incorrect Password",
            description: "The provided password was rejected — it may be incorrect.",
          })
        )
      );
    });
  });
});
