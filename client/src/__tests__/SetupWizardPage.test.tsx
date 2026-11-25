import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SetupWizardPage from "@/pages/setup-wizard";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/setup-wizard", navigate] }));

let wizardState = "pending";
const calls: { method: string; path: string; body?: unknown }[] = [];
const routes: Record<string, unknown> = {
  "/api/config": { igdb: { configured: true } },
  "/api/indexers": [],
  "/api/downloaders": [],
  "/api/settings/steam": { apiKeyConfigured: false },
  "/api/retroachievements": { available: false },
  "/api/settings/nexusmods": { configured: false },
  "/api/settings/apprise": { configured: false },
  "/api/auth/me": { steamId64: null },
  "/api/settings": { importPlatformIds: [], questsEnabled: true, telemetryEnabled: false },
};

beforeEach(() => {
  navigate.mockReset();
  calls.length = 0;
  wizardState = "pending";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*(?=\/api)/, "");
      calls.push({
        method: init?.method ?? "GET",
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const body =
        path === "/api/system/setup-wizard"
          ? { state: init?.method === "PUT" ? "done" : wizardState }
          : routes[path];
      return new Response(JSON.stringify(body ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SetupWizardPage />
    </QueryClientProvider>
  );
}

describe("SetupWizardPage", () => {
  it("shows only the common steps until a platform or downloading is chosen", async () => {
    renderPage();
    await screen.findByText("About your setup");
    expect(screen.getByTestId("wizard-progress-label")).toHaveTextContent(/of 5$/);

    fireEvent.click(screen.getByLabelText(/^PC/));
    fireEvent.click(screen.getByRole("switch", { name: /search for and download/i }));
    await waitFor(() =>
      expect(screen.getByTestId("wizard-progress-label")).toHaveTextContent(/of 11$/)
    );
  });

  it("skips the wizard and returns to the library", async () => {
    renderPage();
    await screen.findByText("About your setup");
    fireEvent.click(screen.getByRole("button", { name: /skip wizard/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(calls).toContainEqual({
      method: "PUT",
      path: "/api/system/setup-wizard",
      body: { state: "done" },
    });
  });
});
