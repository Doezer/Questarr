import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import SetupWizardPage from "@/pages/setup-wizard";
import SetupWizardPrompt from "@/components/SetupWizardPrompt";

const navigate = vi.fn();
let location = "/setup-wizard";
vi.mock("wouter", () => ({ useLocation: () => [location, navigate] }));
vi.mock("@/components/PlatformsSettings", () => ({
  default: () => <div>Platforms card</div>,
}));
vi.mock("@/components/ImportSettings", () => ({ default: () => <div>Import card</div> }));
vi.mock("@/components/RetroAchievementsSync", () => ({
  RetroAchievementsSync: () => <div>RetroAchievements card</div>,
}));

let wizardState = "pending";
let routes: Record<string, unknown> = {};
const calls: { method: string; path: string; body?: unknown }[] = [];

function baseRoutes(): Record<string, unknown> {
  return {
    "/api/config": { igdb: { configured: false } },
    "/api/indexers": [],
    "/api/downloaders": [],
    "/api/settings/steam": { apiKeyConfigured: false },
    "/api/retroachievements": { available: false },
    "/api/settings/nexusmods": { configured: false },
    "/api/settings/apprise": { configured: false },
    "/api/settings": {
      importPlatformIds: [],
      autoSearchEnabled: true,
      autoDownloadEnabled: false,
      searchIntervalHours: 6,
      questsEnabled: true,
      telemetryEnabled: false,
    },
  };
}

beforeEach(() => {
  navigate.mockReset();
  calls.length = 0;
  location = "/setup-wizard";
  wizardState = "pending";
  routes = baseRoutes();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*(?=\/api)/, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body =
        path === "/api/system/setup-wizard"
          ? { state: method === "PUT" ? "done" : wizardState }
          : routes[path];
      return new Response(JSON.stringify(body ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Start|Next)$/ }));

describe("setup wizard steps", () => {
  it("walks the download and PC steps and saves what is typed", async () => {
    wrap(<SetupWizardPage />);
    await screen.findByText("About your setup");
    fireEvent.click(screen.getByLabelText(/^PC/));
    fireEvent.click(screen.getByRole("switch", { name: /search for and download/i }));
    next();

    // IGDB
    await screen.findByLabelText("Client ID");
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "def" } });
    fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/api/settings/igdb",
          body: { clientId: "abc", clientSecret: "def" },
        })
      )
    );

    next();
    await screen.findByText("Platforms card");
    next();
    await screen.findByText("0 indexers");
    next();
    await screen.findByText("0 download clients");
    next();

    // Automation
    await screen.findByRole("switch", { name: /search for wanted games/i });
    fireEvent.click(screen.getByRole("switch", { name: /download the best release/i }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "PATCH",
          path: "/api/settings",
          body: { autoDownloadEnabled: true },
        })
      )
    );
    next();
    await screen.findByText("Import card");
    next();

    // Steam
    fireEvent.change(await screen.findByLabelText("Steam Web API key"), {
      target: { value: "ABCDEF0123456789ABCDEF" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/api/settings/steam",
          body: { apiKey: "ABCDEF0123456789ABCDEF" },
        })
      )
    );
    fireEvent.change(screen.getByLabelText("Steam ID (64-bit)"), {
      target: { value: "76561198000000000" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ path: "/api/user/steam-id" }))
    );
    next();

    // NexusMods
    fireEvent.change(await screen.findByLabelText("Personal API key"), {
      target: { value: "nexus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: "/api/settings/nexusmods", body: { apiKey: "nexus" } })
      )
    );
    next();

    // Quests and diagnostics
    fireEvent.click(await screen.findByRole("switch", { name: /error reports/i }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: "PATCH", body: { telemetryEnabled: true } })
      )
    );
    next();

    // Summary, then finish
    await screen.findByText("All set");
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("offers notifications and retro steps when asked for", async () => {
    wrap(<SetupWizardPage />);
    await screen.findByText("About your setup");
    fireEvent.click(screen.getByLabelText(/^Retro/));
    fireEvent.click(screen.getByRole("switch", { name: /notifications outside/i }));
    next();
    await screen.findByLabelText("Client ID");
    next();
    await screen.findByText("Platforms card");
    next();
    await screen.findByText("RetroAchievements card");
    next();
    await screen.findByText("Apprise");
    expect(screen.getByRole("link", { name: /open notification settings/i })).toBeTruthy();
  });

  it("skips configured services for an install that predates the wizard", async () => {
    wizardState = "never";
    routes["/api/config"] = { igdb: { configured: true } };
    routes["/api/settings/steam"] = { apiKeyConfigured: true };
    routes["/api/settings/nexusmods"] = { configured: true };
    wrap(<SetupWizardPage />);
    await screen.findByText("About your setup");
    // Steam is configured, so PC is guessed and its steps are skipped; IGDB is skipped too.
    await waitFor(() =>
      expect(screen.getByTestId("wizard-progress-label")).toHaveTextContent(/of 4$/)
    );
    expect(screen.getByRole("switch", { name: /only show what is not configured/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /only show what is not configured/i }));
    await waitFor(() =>
      expect(screen.getByTestId("wizard-progress-label")).not.toHaveTextContent(/of 4$/)
    );
  });
});

describe("SetupWizardPrompt", () => {
  it("is offered to an install that predates the wizard and can be dismissed", async () => {
    wizardState = "never";
    location = "/";
    wrap(<SetupWizardPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: /open wizard/i }));
    expect(navigate).toHaveBeenCalledWith("/setup-wizard");
    fireEvent.click(screen.getByRole("button", { name: /dismiss setup wizard prompt/i }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "PUT",
          path: "/api/system/setup-wizard",
          body: { state: "done" },
        })
      )
    );
  });

  it("stays hidden once done, and on the wizard itself", async () => {
    wizardState = "done";
    location = "/";
    const { container, unmount } = wrap(<SetupWizardPrompt />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container.textContent).toBe("");
    unmount();
    wizardState = "pending";
    location = "/setup-wizard";
    const second = wrap(<SetupWizardPrompt />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(second.container.textContent).toBe("");
  });
});
