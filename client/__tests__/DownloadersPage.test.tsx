/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "@shared/schema";

import DownloadersPage from "../src/pages/downloaders";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Radix Select doesn't open in jsdom; a native <select> keeps the page's own
// onValueChange logic (default ports, settings JSON) under test.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

let requests: RecordedRequest[];
let downloaders: Downloader[];
let responders: Array<(req: RecordedRequest) => Response | undefined>;

function json(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function makeDownloader(overrides: Partial<Downloader>): Downloader {
  return {
    id: "d1",
    name: "Client",
    type: "transmission",
    url: "192.168.1.10",
    port: 9091,
    useSsl: false,
    urlPath: null,
    username: null,
    password: null,
    enabled: true,
    priority: 1,
    downloadPath: null,
    category: null,
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    allowSelfSignedCertificate: false,
    allowInsecureLan: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as Downloader;
}

beforeEach(() => {
  toastSpy.mockReset();
  requests = [];
  downloaders = [];
  responders = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getRequestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    const req = { method, url, body };
    requests.push(req);
    for (const responder of responders) {
      const response = responder(req);
      if (response) return response;
    }
    if (url === "/api/downloaders" && method === "GET") return json(downloaders);
    return json({ success: true, message: "ok" });
  }) as typeof fetch;
});

function renderPage() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <DownloadersPage />
    </QueryClientProvider>
  );
}

function requestsTo(method: string, url: string): RecordedRequest[] {
  return requests.filter((r) => r.method === method && r.url === url);
}

async function openEditDialog(downloader: Downloader) {
  downloaders = [downloader];
  renderPage();
  fireEvent.click(await screen.findByTestId(`button-edit-downloader-${downloader.id}`));
  return screen.findByRole("dialog");
}

describe("DownloadersPage", () => {
  describe("list", () => {
    it("shows the empty state and opens a blank Add dialog from it", async () => {
      renderPage();

      expect(await screen.findByText("No Downloaders Configured")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("button-add-downloader-empty"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Add Downloader")).toBeInTheDocument();
      expect(within(dialog).getByTestId("input-downloader-name")).toHaveValue("");
      expect(within(dialog).getByTestId("button-save-downloader")).toHaveTextContent("Add");
    });

    it("orders clients enabled-first by priority and badges each one", async () => {
      downloaders = [
        makeDownloader({ id: "off", name: "Old rTorrent", type: "rtorrent", enabled: false }),
        makeDownloader({
          id: "sab",
          name: "SAB",
          type: "sabnzbd",
          priority: 2,
          downloadPath: "/ignored/for/usenet",
          category: "games",
          username: "apikey",
        }),
        makeDownloader({
          id: "qbit",
          name: "qBit",
          type: "qbittorrent",
          priority: 1,
          downloadPath: "/downloads",
        }),
      ];
      renderPage();

      const cards = await screen.findAllByTestId(/^card-downloader-/);
      expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
        "card-downloader-qbit",
        "card-downloader-sab",
        "card-downloader-off",
      ]);

      const sab = within(screen.getByTestId("card-downloader-sab"));
      expect(sab.getByText("USENET")).toBeInTheDocument();
      expect(sab.getByText("Category: games")).toBeInTheDocument();
      expect(sab.getByText("Authenticated")).toBeInTheDocument();
      expect(sab.queryByText(/^Path:/)).not.toBeInTheDocument();

      const qbit = within(screen.getByTestId("card-downloader-qbit"));
      expect(qbit.getByText("TORRENT")).toBeInTheDocument();
      expect(qbit.getByText("Path: /downloads")).toBeInTheDocument();
      expect(qbit.queryByText("Authenticated")).not.toBeInTheDocument();

      expect(screen.getByTestId("status-downloader-off")).toHaveTextContent("Disabled");
      expect(screen.getByTestId("status-downloader-qbit")).toHaveTextContent("Enabled");
    });

    it("toggles a client off through the switch", async () => {
      downloaders = [makeDownloader({ id: "d1" })];
      renderPage();

      fireEvent.click(await screen.findByTestId("switch-downloader-enabled-d1"));

      await waitFor(() =>
        expect(requestsTo("PATCH", "/api/downloaders/d1")[0]?.body).toEqual({ enabled: false })
      );
    });

    it("clamps priority edits to 1-100 and only saves real changes", async () => {
      downloaders = [makeDownloader({ id: "d1", priority: 1 })];
      renderPage();
      const card = within(await screen.findByTestId("card-downloader-d1"));

      fireEvent.click(card.getByRole("button", { name: "Decrease priority" }));
      expect(card.getByLabelText("Priority value")).toHaveValue(1);
      expect(requestsTo("PATCH", "/api/downloaders/d1")).toHaveLength(0);

      fireEvent.click(card.getByRole("button", { name: "Increase priority" }));
      await waitFor(() =>
        expect(requestsTo("PATCH", "/api/downloaders/d1")[0]?.body).toEqual({ priority: 2 })
      );

      const input = card.getByLabelText("Priority value");
      fireEvent.change(input, { target: { value: "250" } });
      fireEvent.blur(input, { target: { value: "250" } });
      await waitFor(() =>
        expect(requestsTo("PATCH", "/api/downloaders/d1")[1]?.body).toEqual({ priority: 100 })
      );
      expect(input).toHaveValue(100);
    });

    it("reports a successful and a failed delete", async () => {
      downloaders = [makeDownloader({ id: "d1" }), makeDownloader({ id: "d2", name: "Other" })];
      responders.push((req) =>
        req.method === "DELETE" && req.url === "/api/downloaders/d2"
          ? json({ error: "nope" }, 500)
          : undefined
      );
      renderPage();

      fireEvent.click(await screen.findByTestId("button-delete-downloader-d1"));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({ title: "Downloader deleted successfully" })
      );

      fireEvent.click(screen.getByTestId("button-delete-downloader-d2"));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({
          title: "Failed to delete downloader",
          variant: "destructive",
        })
      );
    });

    it.each([
      {
        label: "a working connection",
        response: json({ success: true, message: "Connected to qBittorrent 5.0" }),
        toast: { title: "Connection successful", description: "Connected to qBittorrent 5.0" },
      },
      {
        label: "a refused connection",
        response: json({ success: false, message: "401 Unauthorized" }),
        toast: {
          title: "Connection failed",
          description: "401 Unauthorized",
          variant: "destructive",
        },
      },
      {
        label: "a server error",
        response: json({ error: "Downloader not found" }, 404),
        toast: {
          title: "Test failed",
          description: "Downloader not found",
          variant: "destructive",
        },
      },
    ])("tests a saved client and reports $label", async ({ response, toast }) => {
      downloaders = [makeDownloader({ id: "d1", name: "qBit" })];
      responders.push((req) => (req.url === "/api/downloaders/d1/test" ? response : undefined));
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: "Test connection for qBit" }));

      await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toast));
      expect(requestsTo("POST", "/api/downloaders/d1/test")).toHaveLength(1);
    });
  });

  describe("edit dialog per client type", () => {
    it("SABnzbd asks for an API key, offers self-signed TLS and an archive password", async () => {
      const dialog = within(
        await openEditDialog(
          makeDownloader({
            id: "sab",
            type: "sabnzbd",
            port: 8080,
            username: "key",
            settings: JSON.stringify({ archivePassword: "404" }),
          })
        )
      );

      expect(dialog.getByText("Edit Downloader")).toBeInTheDocument();
      expect(dialog.getByText("API Key")).toBeInTheDocument();
      expect(dialog.getByPlaceholderText("Enter SABnzbd API key")).toHaveValue("key");
      expect(dialog.getByText("Password (Optional)")).toBeInTheDocument();
      expect(
        dialog.getByTestId("checkbox-downloader-allow-self-signed-certificate")
      ).toBeInTheDocument();
      expect(dialog.getByTestId("input-downloader-archive-password")).toHaveValue("404");
      expect(dialog.queryByTestId("input-downloader-path")).not.toBeInTheDocument();
      expect(
        dialog.getByText("Category for NZBs in downloader (path is managed by category settings)")
      ).toBeInTheDocument();
      expect(dialog.getByTestId("button-save-downloader")).toHaveTextContent("Update");
    });

    it("Synology requires DSM credentials and a shared-folder-relative path", async () => {
      const dialog = within(
        await openEditDialog(makeDownloader({ id: "syn", type: "synology", port: 5000 }))
      );

      expect(dialog.getAllByText("Required for DSM login.")).toHaveLength(2);
      expect(dialog.getByPlaceholderText("video/downloads")).toBeInTheDocument();
      expect(dialog.getByText("DSM 7 commonly uses HTTPS on port 5001")).toBeInTheDocument();
      expect(
        dialog.getByText(
          "Optional Questarr label only. Synology stores downloads by destination path."
        )
      ).toBeInTheDocument();
      expect(
        dialog.queryByTestId("checkbox-downloader-allow-self-signed-certificate")
      ).not.toBeInTheDocument();
    });

    it("rTorrent exposes add-stopped, remove-completed and post-import category", async () => {
      const dialog = within(
        await openEditDialog(
          makeDownloader({ id: "rt", type: "rtorrent", port: null, postImportCategory: "done" })
        )
      );

      expect(dialog.getByText("Username (Optional)")).toBeInTheDocument();
      expect(dialog.getByTestId("checkbox-downloader-addstopped")).toBeInTheDocument();
      expect(dialog.getByTestId("checkbox-downloader-removecompleted")).toBeInTheDocument();
      expect(dialog.getByTestId("input-downloader-postimportcategory")).toHaveValue("done");
      expect(dialog.getByTestId("input-downloader-port")).toHaveAttribute(
        "placeholder",
        "80 or 443"
      );
    });

    it("NZBGet shows the archive password but no download path", async () => {
      const dialog = within(
        await openEditDialog(makeDownloader({ id: "nzb", type: "nzbget", port: 6789 }))
      );

      expect(dialog.getByText("Enable HTTPS in NZBGet (Settings → Security)")).toBeInTheDocument();
      expect(dialog.getByTestId("input-downloader-archive-password")).toHaveValue("");
      expect(dialog.queryByTestId("input-downloader-path")).not.toBeInTheDocument();
    });

    it("refuses to convert a downloader to TorBox without a new API key", async () => {
      const dialog = within(
        await openEditDialog(makeDownloader({ id: "qb", type: "qbittorrent", port: 8080 }))
      );

      const typeSelect = dialog.getByRole("option", { name: "TorBox" })
        .parentElement as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: "torbox" } });
      fireEvent.click(dialog.getByTestId("button-save-downloader"));

      expect(await dialog.findByText("An API key is required for TorBox")).toBeInTheDocument();
      expect(requestsTo("PATCH", "/api/downloaders/qb")).toHaveLength(0);
    });

    it("tests the saved TorBox key when the dialog still holds the masked password", async () => {
      const dialog = within(
        await openEditDialog(
          makeDownloader({
            id: "tb",
            type: "torbox",
            password: "********",
            downloadPath: "/staging",
          })
        )
      );

      fireEvent.click(dialog.getByTestId("button-test-connection-dialog"));

      await waitFor(() => expect(requestsTo("POST", "/api/downloaders/tb/test")).toHaveLength(1));
      expect(requestsTo("POST", "/api/downloaders/test")).toHaveLength(0);
    });

    it("refuses to convert a downloader to TorBox when the masked password is still set", async () => {
      const dialog = within(
        await openEditDialog(
          makeDownloader({
            id: "tr",
            type: "transmission",
            port: 9091,
            password: "********",
            downloadPath: "/staging",
          })
        )
      );

      const typeSelect = dialog.getByRole("option", { name: "TorBox" })
        .parentElement as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: "torbox" } });
      fireEvent.click(dialog.getByTestId("button-save-downloader"));

      expect(await dialog.findByText("An API key is required for TorBox")).toBeInTheDocument();
      expect(requestsTo("PATCH", "/api/downloaders/tr")).toHaveLength(0);
    });

    it("clears the carried-over password when the type changes and restores it on return", async () => {
      const dialog = within(
        await openEditDialog(
          makeDownloader({ id: "tr", type: "transmission", port: 9091, password: "********" })
        )
      );
      const password = dialog.getByTestId("input-downloader-password");
      expect(password).toHaveValue("********");

      const typeSelect = dialog.getByRole("option", { name: "TorBox" })
        .parentElement as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: "torbox" } });
      expect(dialog.getByTestId("input-downloader-password")).toHaveValue("");

      fireEvent.change(typeSelect, { target: { value: "transmission" } });
      expect(dialog.getByTestId("input-downloader-password")).toHaveValue("********");
    });

    it("qBittorrent stores the chosen initial state in the settings JSON", async () => {
      downloaders = [makeDownloader({ id: "qb", name: "qBit", type: "qbittorrent", port: 8080 })];
      renderPage();
      fireEvent.click(await screen.findByTestId("button-edit-downloader-qb"));
      const dialog = within(await screen.findByRole("dialog"));

      const initialState = dialog.getByRole("option", { name: "Force started" })
        .parentElement as HTMLSelectElement;
      expect(initialState).toHaveValue("started");
      fireEvent.change(initialState, { target: { value: "force-started" } });
      expect(initialState).toHaveValue("force-started");

      fireEvent.click(dialog.getByTestId("button-save-downloader"));

      await waitFor(() => expect(requestsTo("PATCH", "/api/downloaders/qb")).toHaveLength(1));
      const body = requestsTo("PATCH", "/api/downloaders/qb")[0]?.body as {
        settings: string;
        addStopped: boolean;
      };
      expect(JSON.parse(body.settings)).toEqual({ initialState: "force-started" });
      expect(body.addStopped).toBe(false);
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({ title: "Downloader updated successfully" })
      );
    });
  });

  describe("add dialog", () => {
    it("moves the port to the new type's default and to the HTTPS default with SSL", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("button-add-downloader-empty"));
      const dialog = within(await screen.findByRole("dialog"));

      const typeSelect = dialog.getByRole("option", { name: "Synology Download Station" })
        .parentElement as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: "synology" } });
      expect(dialog.getByTestId("input-downloader-port")).toHaveValue(5000);
      expect(dialog.getByTestId("checkbox-downloader-allow-insecure-lan")).toBeInTheDocument();

      fireEvent.click(dialog.getByTestId("checkbox-downloader-usessl"));
      expect(dialog.getByTestId("input-downloader-port")).toHaveValue(5001);
      expect(
        dialog.queryByTestId("checkbox-downloader-allow-insecure-lan")
      ).not.toBeInTheDocument();

      // A port the user typed is theirs: switching type must not overwrite it.
      fireEvent.change(dialog.getByTestId("input-downloader-port"), { target: { value: "7000" } });
      fireEvent.change(typeSelect, { target: { value: "deluge" } });
      expect(dialog.getByTestId("input-downloader-port")).toHaveValue(7000);
    });

    it("clears the SABnzbd-only self-signed flag when switching to another type", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("button-add-downloader-empty"));
      const dialog = within(await screen.findByRole("dialog"));
      const typeSelect = dialog.getByRole("option", { name: "SABnzbd" })
        .parentElement as HTMLSelectElement;

      fireEvent.change(typeSelect, { target: { value: "sabnzbd" } });
      const selfSigned = dialog.getByTestId("checkbox-downloader-allow-self-signed-certificate");
      fireEvent.click(selfSigned);
      expect(selfSigned).toHaveAttribute("data-state", "checked");

      fireEvent.change(typeSelect, { target: { value: "nzbget" } });
      fireEvent.change(typeSelect, { target: { value: "sabnzbd" } });
      expect(
        dialog.getByTestId("checkbox-downloader-allow-self-signed-certificate")
      ).toHaveAttribute("data-state", "unchecked");
    });

    it("tests the unsaved form, then saves it as a new client", async () => {
      let resolveTest: (r: Response) => void = () => {};
      responders.push((req) =>
        req.url === "/api/downloaders/test"
          ? (new Promise<Response>((resolve) => {
              resolveTest = resolve;
            }) as unknown as Response)
          : undefined
      );
      renderPage();
      fireEvent.click(await screen.findByTestId("button-add-downloader-empty"));
      const dialog = within(await screen.findByRole("dialog"));

      fireEvent.change(dialog.getByTestId("input-downloader-name"), {
        target: { value: "Seedbox" },
      });
      fireEvent.change(dialog.getByTestId("input-downloader-url"), {
        target: { value: "seedbox.lan" },
      });

      fireEvent.click(dialog.getByTestId("button-test-connection-dialog"));
      await waitFor(() =>
        expect(dialog.getByTestId("button-test-connection-dialog")).toHaveTextContent("Testing...")
      );
      expect(requestsTo("POST", "/api/downloaders/test")[0]?.body).toMatchObject({
        name: "Seedbox",
        url: "seedbox.lan",
        type: "transmission",
      });

      resolveTest(json({ success: true, message: "Transmission 4.0" }));
      await waitFor(() =>
        expect(dialog.getByTestId("button-test-connection-dialog")).toHaveTextContent(
          "Test Connection"
        )
      );
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Connection successful",
        description: "Transmission 4.0",
      });

      fireEvent.click(dialog.getByTestId("button-save-downloader"));
      await waitFor(() => expect(requestsTo("POST", "/api/downloaders")).toHaveLength(1));
      expect(requestsTo("POST", "/api/downloaders")[0]?.body).toMatchObject({
        name: "Seedbox",
        url: "seedbox.lan",
        type: "transmission",
        enabled: true,
      });
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({ title: "Downloader added successfully" })
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("does not test or save a form with missing required fields", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("button-add-downloader-empty"));
      const dialog = within(await screen.findByRole("dialog"));

      fireEvent.click(dialog.getByTestId("button-test-connection-dialog"));
      fireEvent.click(dialog.getByTestId("button-save-downloader"));

      await waitFor(() => expect(dialog.getAllByText(/required/i).length).toBeGreaterThan(1));
      expect(requestsTo("POST", "/api/downloaders/test")).toHaveLength(0);
      expect(requestsTo("POST", "/api/downloaders")).toHaveLength(0);
    });

    it("keeps the dialog open and reports a failed save", async () => {
      responders.push((req) =>
        req.method === "POST" && req.url === "/api/downloaders"
          ? json({ error: "bad" }, 400)
          : undefined
      );
      renderPage();
      fireEvent.click(await screen.findByTestId("button-add-downloader-empty"));
      const dialog = within(await screen.findByRole("dialog"));

      fireEvent.change(dialog.getByTestId("input-downloader-name"), { target: { value: "X" } });
      fireEvent.change(dialog.getByTestId("input-downloader-url"), { target: { value: "x.lan" } });
      fireEvent.click(dialog.getByTestId("button-save-downloader"));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({
          title: "Failed to add downloader",
          variant: "destructive",
        })
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
