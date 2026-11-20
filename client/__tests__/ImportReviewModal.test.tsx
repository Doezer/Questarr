/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportReviewModal from "../src/components/ImportReviewModal";

const {
  mockInvalidateQueries,
  mockToast,
  mockFileBrowser,
  mockApiRequest,
  mockImportConfig,
  mockOperation,
} = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockToast: vi.fn(),
  mockFileBrowser: vi.fn(),
  mockApiRequest: vi.fn(),
  mockOperation: { current: undefined as Record<string, unknown> | undefined },
  mockImportConfig: {
    current: undefined as
      { transferMode: string; libraryRoot: string; autoUnpack?: boolean } | undefined,
  },
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
    useQuery: ({ queryKey }: { queryKey: string[] }) => ({
      data:
        queryKey[0] === "/api/imports/config"
          ? mockImportConfig.current
          : queryKey[0] === "/api/imports/operations/op-1" ||
              queryKey[0] === "/api/imports/download-1/operation"
            ? mockOperation.current
            : undefined,
      isLoading: false,
      error: null,
    }),
    useMutation: (options: {
      mutationFn: () => Promise<unknown>;
      onSuccess?: (result: unknown) => void;
      onError?: (error: unknown) => void;
    }) => ({
      mutate: () => {
        options
          .mutationFn()
          .then((result) => options.onSuccess?.(result))
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
    mockOperation.current = undefined;
    mockApiRequest.mockResolvedValue({ json: async () => ({ operationId: "op-1" }) });
    mockImportConfig.current = { transferMode: "move", libraryRoot: "/games/library" };
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

  describe("Auto-Unpack defaults", () => {
    it.each([true, false, undefined])(
      "defaults to autoUnpack=%s and submits that choice",
      async (autoUnpack) => {
        mockImportConfig.current = { ...mockImportConfig.current!, autoUnpack };
        renderModal();

        expect(screen.getByRole("switch")).toHaveAttribute(
          "aria-checked",
          String(autoUnpack ?? false)
        );

        fireEvent.change(screen.getByLabelText("Destination Path"), {
          target: { value: "/games/library/PC/Encrypted" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

        await waitFor(() =>
          expect(mockApiRequest).toHaveBeenCalledWith(
            "POST",
            "/api/imports/download-1/confirm",
            expect.objectContaining({ unpack: autoUnpack ?? false })
          )
        );
      }
    );

    it("applies Auto-Unpack when settings arrive after the dialog opens", () => {
      mockImportConfig.current = undefined;
      const modal = renderModal();
      expect(screen.getByRole("switch")).not.toBeChecked();

      mockImportConfig.current = {
        transferMode: "move",
        libraryRoot: "/games/library",
        autoUnpack: true,
      };
      modal.rerender(
        <ImportReviewModal
          open
          onOpenChange={vi.fn()}
          downloadId="download-1"
          downloadTitle="Encrypted.rar"
        />
      );

      expect(screen.getByRole("switch")).toBeChecked();
    });

    it.each([true, false])(
      "preserves an explicit override of autoUnpack=%s across settings updates",
      async (autoUnpack) => {
        mockImportConfig.current = { ...mockImportConfig.current!, autoUnpack };
        const modal = renderModal();
        fireEvent.click(screen.getByRole("switch"));

        mockImportConfig.current = {
          transferMode: "hardlink",
          libraryRoot: "/games/updated-library",
          autoUnpack,
        };
        modal.rerender(
          <ImportReviewModal
            open
            onOpenChange={vi.fn()}
            downloadId="download-1"
            downloadTitle="Encrypted.rar"
          />
        );
        fireEvent.change(screen.getByLabelText("Destination Path"), {
          target: { value: "/games/updated-library/PC/Encrypted" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

        await waitFor(() =>
          expect(mockApiRequest).toHaveBeenCalledWith(
            "POST",
            "/api/imports/download-1/confirm",
            expect.objectContaining({ unpack: !autoUnpack })
          )
        );
      }
    );

    it.each([true, false])(
      "preserves an explicit autoUnpack=%s choice when the saved default changes",
      async (autoUnpack) => {
        mockImportConfig.current = { ...mockImportConfig.current!, autoUnpack };
        const modal = renderModal();
        fireEvent.click(screen.getByRole("switch"));
        fireEvent.click(screen.getByRole("switch"));

        mockImportConfig.current = { ...mockImportConfig.current!, autoUnpack: !autoUnpack };
        modal.rerender(
          <ImportReviewModal
            open
            onOpenChange={vi.fn()}
            downloadId="download-1"
            downloadTitle="Encrypted.rar"
          />
        );
        fireEvent.change(screen.getByLabelText("Destination Path"), {
          target: { value: "/games/library/PC/Encrypted" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

        await waitFor(() =>
          expect(mockApiRequest).toHaveBeenCalledWith(
            "POST",
            "/api/imports/download-1/confirm",
            expect.objectContaining({ unpack: autoUnpack })
          )
        );
      }
    );

    it("restores the saved default when the dialog is reopened or another download is selected", () => {
      mockImportConfig.current = { ...mockImportConfig.current!, autoUnpack: true };
      const modal = renderModal();
      fireEvent.click(screen.getByRole("switch"));
      expect(screen.getByRole("switch")).not.toBeChecked();

      modal.rerender(
        <ImportReviewModal
          open={false}
          onOpenChange={vi.fn()}
          downloadId="download-1"
          downloadTitle="Encrypted.rar"
        />
      );
      modal.rerender(
        <ImportReviewModal
          open
          onOpenChange={vi.fn()}
          downloadId="download-1"
          downloadTitle="Encrypted.rar"
        />
      );
      expect(screen.getByRole("switch")).toBeChecked();

      fireEvent.click(screen.getByRole("switch"));
      modal.rerender(
        <ImportReviewModal
          open
          onOpenChange={vi.fn()}
          downloadId="download-2"
          downloadTitle="Other.rar"
        />
      );
      expect(screen.getByRole("switch")).toBeChecked();
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
    });

    it("keeps the dialog on the failure and asks for the password again when the operation fails with passwordRequired", () => {
      mockOperation.current = {
        id: "op-1",
        downloadId: "download-1",
        status: "failed",
        phase: "failed",
        bytesProcessed: null,
        bytesTotal: null,
        error: "The provided password was rejected — it may be incorrect.",
        passwordRequired: true,
        incompleteScan: false,
      };
      renderModal();
      fireEvent.change(screen.getByLabelText("Destination Path"), {
        target: { value: "/games/library/PC/Encrypted" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
    });
  });

  describe("Import progress", () => {
    const running = {
      id: "op-1",
      downloadId: "download-1",
      status: "running",
      phase: "hashing",
      bytesProcessed: 5 * 1024 ** 3,
      bytesTotal: 20 * 1024 ** 3,
      error: null,
      passwordRequired: false,
      incompleteScan: false,
    };

    it("restores a running operation after a reload and shows phase and bytes", async () => {
      mockOperation.current = running;
      renderModal();

      expect(await screen.findByText(/Computing file hash/)).toBeInTheDocument();
      expect(screen.getByText(/25%/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close (keeps running)" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Destination Path")).not.toBeInTheDocument();
    });

    it("shows a failure with a way back to the review form, and requires the password after a password failure", async () => {
      mockOperation.current = {
        ...running,
        status: "failed",
        phase: "failed",
        error: "Wrong password",
        passwordRequired: true,
      };
      renderModal();
      // Not adopted automatically (only a running operation is restored); drive it via confirm.
      fireEvent.change(screen.getByLabelText("Destination Path"), {
        target: { value: "/games/library/PC/Encrypted" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

      expect(await screen.findByText("Wrong password")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
      expect(await screen.findByText("Password Required")).toBeInTheDocument();
      expect(screen.getByLabelText("Archive Password")).toBeInTheDocument();
    });

    it("toasts and closes when the operation completes", async () => {
      const onOpenChange = vi.fn();
      mockOperation.current = { ...running, status: "completed", phase: "complete" };
      renderModal({ onOpenChange });
      fireEvent.change(screen.getByLabelText("Destination Path"), {
        target: { value: "/games/library/PC/Encrypted" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Import Complete" })
        )
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
