/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LogsPage from "../src/pages/logs";

const { apiRequestMock, toastMock, mobileState, logStreamState, resizeObserverState } = vi.hoisted(
  () => ({
    apiRequestMock: vi.fn(),
    toastMock: vi.fn(),
    mobileState: { value: false },
    logStreamState: {
      callback: null as ((line: string) => void) | null,
    },
    resizeObserverState: {
      observe: vi.fn(),
      disconnect: vi.fn(),
    },
  })
);

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: apiRequestMock,
    queryClient: new QueryClient(),
  };
});

vi.mock("@/hooks/use-log-stream", () => ({
  useLogStream: (onLine: (line: string) => void) => {
    logStreamState.callback = onLine;
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
    SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
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

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-testid="sheet-root" data-open={open ? "true" : "false"}>
      {children}
      {open && (
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Close inspector
        </button>
      )}
    </div>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const icon = (name: string) => () => <span data-testid={name} />;
  return {
    ...actual,
    Copy: icon("icon-copy"),
    PauseCircle: icon("icon-pause"),
    PlayCircle: icon("icon-play"),
    ScrollText: icon("icon-scroll"),
    Search: icon("icon-search"),
    Trash2: icon("icon-trash"),
  };
});

function renderPage(initialData?: { lines: string[] }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initialData) {
    queryClient.setQueryData(["/api/logs"], initialData);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <LogsPage />
    </QueryClientProvider>
  );
}

describe("LogsPage remaining coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileState.value = false;
    logStreamState.callback = null;
    resizeObserverState.observe.mockReset();
    resizeObserverState.disconnect.mockReset();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = resizeObserverState.observe;
        disconnect = resizeObserverState.disconnect;
      }
    );
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe = resizeObserverState.observe;
        disconnect = resizeObserverState.disconnect;
      },
    });
    vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("covers desktop filters, stream updates, copy, clear, pause, and inspector close", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({
        lines: [
          JSON.stringify({
            level: 30,
            time: "2026-04-16T08:01:00.000Z",
            module: "routes",
            msg: "Info message",
            userId: 42,
            path: "/api/logs",
          }),
          JSON.stringify({
            level: 50,
            time: "2026-04-16T08:02:00.000Z",
            module: "cron",
            msg: "Error message",
            error: { message: "Boom" },
          }),
        ],
      }),
    } as Response);

    const { unmount } = renderPage();
    await screen.findByText("Server Logs");
    await screen.findByRole("log", { name: "Server log output" });
    await screen.findAllByTestId("log-line-row");

    fireEvent.click(screen.getByText("Error+"));
    fireEvent.click(screen.getAllByText("cron")[0]);
    fireEvent.change(screen.getByLabelText("Search log lines"), {
      target: { value: "error" },
    });
    expect(await screen.findByText("Error message")).toBeInTheDocument();

    logStreamState.callback?.(
      JSON.stringify({ level: 50, module: "cron", msg: "error streamed", time: Date.now() })
    );
    expect(await screen.findByText("error streamed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Inspect log Error message/i }));
    expect(await screen.findByText("Log details")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy raw log line" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copied",
        description: "Raw log line copied",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy parsed payload" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copied",
        description: "Parsed payload copied",
      });
    });

    fireEvent.click(screen.getByText("Close inspector"));
    expect(screen.queryByText("Log details")).not.toBeInTheDocument();

    const viewport = screen.getByTestId("logs-viewport");
    Object.defineProperties(viewport, {
      scrollTop: { value: 10, writable: true },
      scrollHeight: { value: 200, writable: true },
      clientHeight: { value: 100, writable: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause auto-scroll" }));
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "Resume auto-scroll" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy log lines" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copied",
        description: expect.stringContaining("log lines copied to clipboard"),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear log lines" }));
    expect(await screen.findByText("No log lines to display.")).toBeInTheDocument();
    unmount();
    unmount();
  });

  it("covers mobile cards, empty metadata states, and clipboard failures", async () => {
    mobileState.value = true;
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clipboard denied"));
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    apiRequestMock.mockResolvedValue({
      json: async () => ({
        lines: [
          JSON.stringify({
            level: 15,
            msg: "",
          }),
        ],
      }),
    } as Response);

    renderPage();
    await screen.findByText("Server Logs");
    await screen.findByRole("log", { name: "Server log output" });
    await screen.findAllByTestId("log-line-row");

    fireEvent.click(screen.getByRole("button", { name: /Inspect log/ }));
    expect(
      await screen.findByText("No additional structured metadata was present on this log line.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("No timestamp").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Copy raw log line" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copied",
        description: "Raw log line copied",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy parsed payload" }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Copy failed",
        description: "Clipboard access denied",
        variant: "destructive",
      });
    });
  });

  it("covers cached viewport setup, fallback parsing, sort branches, and active auto-scroll changes", async () => {
    const originalStringify = JSON.stringify;
    const cachedData = {
      lines: [
        "plain text fallback line",
        originalStringify({
          level: 30,
          time: "2026-04-16T08:03:00.000Z",
          module: "routes",
          msg: "Sorted message",
          aaa: { throwPretty: true },
          userId: 7,
          zzz: { throwInline: true },
        }),
      ],
    };

    const stringifySpy = vi
      .spyOn(JSON, "stringify")
      .mockImplementation((value, replacer, space) => {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          ("throwPretty" in value || "throwInline" in value)
        ) {
          throw new Error("stringify failed");
        }
        return originalStringify(value, replacer as never, space as never);
      });

    renderPage(cachedData);
    await screen.findByRole("log", { name: "Server log output" });
    expect(resizeObserverState.observe).toHaveBeenCalled();

    const viewport = screen.getByTestId("logs-viewport");
    Object.defineProperties(viewport, {
      scrollTop: { value: 10, writable: true },
      scrollHeight: { value: 300, writable: true },
      clientHeight: { value: 100, writable: true },
    });
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "Resume auto-scroll" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("routes")[0]);
    fireEvent.change(screen.getByLabelText("Search log lines"), { target: { value: "missing" } });
    expect(screen.getByText("No log lines to display.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search log lines"), { target: { value: "sorted" } });
    fireEvent.click(screen.getByRole("button", { name: /Inspect log Sorted message/i }));
    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => (element?.textContent ?? "").includes("userId")).length
      ).toBeGreaterThan(0);
    });
    stringifySpy.mockRestore();
  });
});
