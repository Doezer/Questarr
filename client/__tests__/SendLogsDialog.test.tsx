/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock, scrubLogLinesMock, detectPlatformMock, sendLogsMock, buildGitHubIssueUrlMock } =
  vi.hoisted(() => ({
    toastMock: vi.fn(),
    scrubLogLinesMock: vi.fn((lines: string[]) => lines.join("\n")),
    detectPlatformMock: vi.fn(() => "Windows"),
    sendLogsMock: vi.fn(),
    buildGitHubIssueUrlMock: vi.fn(
      () => "https://github.com/Doezer/Questarr/issues/new?title=test"
    ),
  }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/send-logs", () => ({
  scrubLogLines: scrubLogLinesMock,
  detectPlatform: detectPlatformMock,
  sendLogs: sendLogsMock,
  buildGitHubIssueUrl: buildGitHubIssueUrlMock,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    children: React.ReactNode;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const icon = (name: string) => () => <span data-testid={name} />;
  return {
    ...actual,
    Copy: icon("icon-copy"),
    ExternalLink: icon("icon-external-link"),
    Loader2: icon("icon-loader"),
    Send: icon("icon-send"),
    ShieldAlert: icon("icon-shield"),
  };
});

import SendLogsDialog from "../src/components/SendLogsDialog";

describe("SendLogsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("submits scrubbed logs and shows the success state", async () => {
    sendLogsMock.mockResolvedValue({ ok: true, code: "ABCD", gistId: "gist-123" });
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <SendLogsDialog
        open={true}
        onOpenChange={onOpenChange}
        logLines={["user@example.com", "10.0.0.1"]}
      />
    );

    expect(screen.getByText("Send logs to support")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send logs" }));

    expect(await screen.findByText("Logs uploaded")).toBeInTheDocument();
    expect(scrubLogLinesMock).toHaveBeenCalledWith(["user@example.com", "10.0.0.1"]);
    expect(sendLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: "user@example.com\n10.0.0.1",
        appVersion: "unknown",
        platform: "Windows",
      })
    );
    expect(buildGitHubIssueUrlMock).toHaveBeenCalledWith("ABCD", "unknown");

    fireEvent.click(screen.getByRole("button", { name: "Copy support code" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD");
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: "Copied",
      description: "Code ABCD copied to clipboard",
    });

    expect(screen.getByRole("link", { name: "Create GitHub issue" })).toHaveAttribute(
      "href",
      "https://github.com/Doezer/Questarr/issues/new?title=test"
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(<SendLogsDialog open={false} onOpenChange={onOpenChange} logLines={["x"]} />);
    rerender(<SendLogsDialog open={true} onOpenChange={onOpenChange} logLines={["x"]} />);
    expect(screen.getByText("Send logs to support")).toBeInTheDocument();
  });

  it("shows an error state, rate-limit guidance, and lets the user retry", async () => {
    sendLogsMock.mockResolvedValue({
      ok: false,
      status: 429,
      message: "Rate limit reached (5 submissions per hour). Try again later.",
    });

    render(<SendLogsDialog open={true} onOpenChange={vi.fn()} logLines={["line 1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Send logs" }));

    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    expect(screen.getByText(/5 log bundles per hour/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Send logs to support")).toBeInTheDocument();
  });

  it("shows a destructive toast when copying the support code fails", async () => {
    sendLogsMock.mockResolvedValue({ ok: true, code: "WXYZ", gistId: "gist-999" });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

    render(<SendLogsDialog open={true} onOpenChange={vi.fn()} logLines={["line 1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Send logs" }));
    expect(await screen.findByText("Logs uploaded")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy support code" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copy failed",
        description: "Clipboard access denied",
        variant: "destructive",
      });
    });
  });

  it("disables submission when there are no logs to send and can be cancelled", () => {
    const onOpenChange = vi.fn();
    render(<SendLogsDialog open={true} onOpenChange={onOpenChange} logLines={[]} />);

    expect(screen.getByRole("button", { name: "Send logs" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
