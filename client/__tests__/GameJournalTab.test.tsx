/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GameJournalTab from "../src/components/GameJournalTab";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const GAME_ID = "game-1";
const BASE = `/api/games/${GAME_ID}`;

interface Milestone {
  id: string;
  gameId: string;
  label: string;
  completedAt: string | null;
  createdAt: string;
}

interface Entry {
  id: string;
  gameId: string;
  note: string;
  createdAt: string;
}

interface Screenshot {
  id: string;
  filePath: string;
  caption: string | null;
  createdAt: string;
  url: string;
}

interface Achievement {
  apiName: string;
  displayName: string;
  description: string | null;
  icon: string;
  iconGray: string;
  hidden: boolean;
  achieved: boolean;
  unlockedAt: number | null;
  globalPercent: number | null;
}

interface ServerState {
  steamApiKeyConfigured: boolean;
  achievements: Achievement[];
  entries: Entry[];
  milestones: Milestone[];
  screenshots: Screenshot[];
  failPostJournal: boolean;
  failGetScreenshots: boolean;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

let state: ServerState;
let requests: RecordedRequest[];
let nextId: number;

function json(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data),
    clone() {
      return this;
    },
  } as Response;
}

function installFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getRequestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    requests.push({ method, url, body });

    if (url === "/api/settings/steam") {
      return json({ apiKeyConfigured: state.steamApiKeyConfigured });
    }
    if (url === `${BASE}/achievements`) {
      return json({ achievements: state.achievements });
    }

    if (url === `${BASE}/journal`) {
      if (method === "POST") {
        if (state.failPostJournal) return json({ error: "boom" }, 500);
        const entry: Entry = {
          id: `e${nextId++}`,
          gameId: GAME_ID,
          note: (body as { note: string }).note,
          createdAt: "2026-09-01T10:00:00.000Z",
        };
        state.entries = [entry, ...state.entries];
        return json(entry);
      }
      return json(state.entries);
    }
    const journalItem = url.match(/\/journal\/(.+)$/);
    if (journalItem && method === "DELETE") {
      state.entries = state.entries.filter((e) => e.id !== journalItem[1]);
      return json({ success: true });
    }

    if (url === `${BASE}/milestones`) {
      if (method === "POST") {
        const milestone: Milestone = {
          id: `m${nextId++}`,
          gameId: GAME_ID,
          label: (body as { label: string }).label,
          completedAt: null,
          createdAt: "2026-09-01T10:00:00.000Z",
        };
        state.milestones = [...state.milestones, milestone];
        return json(milestone);
      }
      return json(state.milestones);
    }
    const milestoneItem = url.match(/\/milestones\/(.+)$/);
    if (milestoneItem) {
      const id = milestoneItem[1];
      if (method === "PATCH") {
        const completed = (body as { completed: boolean }).completed;
        state.milestones = state.milestones.map((m) =>
          m.id === id ? { ...m, completedAt: completed ? "2026-09-02T10:00:00.000Z" : null } : m
        );
        return json({ success: true });
      }
      if (method === "DELETE") {
        state.milestones = state.milestones.filter((m) => m.id !== id);
        return json({ success: true });
      }
    }

    if (url === `${BASE}/screenshots`) {
      if (method === "GET" && state.failGetScreenshots) return json({ error: "unavailable" }, 500);
      if (method === "POST") {
        const shot: Screenshot = {
          id: `s${nextId++}`,
          filePath: "shot.png",
          caption: null,
          createdAt: "2026-09-01T10:00:00.000Z",
          url: "/api/screenshots/shot.png",
        };
        state.screenshots = [...state.screenshots, shot];
        return json(shot);
      }
      return json(state.screenshots);
    }
    const screenshotItem = url.match(/\/screenshots\/(.+)$/);
    if (screenshotItem && method === "DELETE") {
      state.screenshots = state.screenshots.filter((s) => s.id !== screenshotItem[1]);
      return json({ success: true });
    }

    return json({ error: `unexpected ${method} ${url}` }, 404);
  }) as typeof fetch;
}

function renderTab(steamAppId: number | null = null) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GameJournalTab gameId={GAME_ID} steamAppId={steamAppId} />
    </QueryClientProvider>
  );
}

function requestsTo(method: string, pattern: RegExp): RecordedRequest[] {
  return requests.filter((r) => r.method === method && pattern.test(r.url));
}

beforeEach(() => {
  toastSpy.mockReset();
  requests = [];
  nextId = 1;
  state = {
    steamApiKeyConfigured: false,
    achievements: [],
    entries: [],
    milestones: [],
    screenshots: [],
    failPostJournal: false,
    failGetScreenshots: false,
  };
  installFetch();
});

describe("GameJournalTab", () => {
  it("shows screenshot fetch failures and recovers with Retry", async () => {
    state.failGetScreenshots = true;
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your screenshots.");
    expect(screen.queryByText("No screenshots yet.")).not.toBeInTheDocument();
    state.failGetScreenshots = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No screenshots yet.")).toBeInTheDocument();
  });

  it("shows empty states and skips achievements when Steam is not configured", async () => {
    renderTab(620);

    expect(await screen.findByText("No milestones yet.")).toBeInTheDocument();
    expect(screen.getByText("No journal entries yet.")).toBeInTheDocument();
    expect(await screen.findByText("No screenshots yet.")).toBeInTheDocument();

    await waitFor(() => expect(requestsTo("GET", /\/api\/settings\/steam$/)).toHaveLength(1));
    expect(requestsTo("GET", /\/achievements$/)).toHaveLength(0);
    expect(screen.queryByText("Achievements")).not.toBeInTheDocument();
  });

  it("does not ask for achievements for a game without a Steam app id", async () => {
    state.steamApiKeyConfigured = true;
    renderTab(null);

    await screen.findByText("No milestones yet.");
    await waitFor(() => expect(requestsTo("GET", /\/api\/settings\/steam$/)).toHaveLength(1));
    expect(requestsTo("GET", /\/achievements$/)).toHaveLength(0);
  });

  it("lists Steam achievements with the unlocked count, rarity and locked icon", async () => {
    state.steamApiKeyConfigured = true;
    state.achievements = [
      {
        apiName: "WIN",
        displayName: "Beat the game",
        description: "Finish the story",
        icon: "https://cdn.example/win.png",
        iconGray: "https://cdn.example/win-gray.png",
        hidden: false,
        achieved: true,
        unlockedAt: 1_700_000_000,
        globalPercent: 42.345,
      },
      {
        apiName: "SECRET",
        displayName: "Hidden path",
        description: null,
        icon: "https://cdn.example/secret.png",
        iconGray: "https://cdn.example/secret-gray.png",
        hidden: true,
        achieved: false,
        unlockedAt: null,
        globalPercent: null,
      },
    ];
    const { container } = renderTab(620);

    expect(await screen.findByText("Achievements")).toBeInTheDocument();
    expect(screen.getByText("Beat the game")).toBeInTheDocument();
    expect(screen.getByText("Finish the story")).toBeInTheDocument();
    expect(screen.getByText("42.3% of players")).toBeInTheDocument();
    expect(screen.getByText("Hidden path")).toBeInTheDocument();
    expect(screen.getAllByText(/% of players/)).toHaveLength(1);

    const heading = screen.getByText("Achievements").closest("h3");
    expect(heading).toHaveTextContent("1/2");

    const icons = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("src")
    );
    expect(icons).toContain("https://cdn.example/win.png");
    expect(icons).toContain("https://cdn.example/secret-gray.png");
    expect(icons).not.toContain("https://cdn.example/secret.png");
  });

  it("adds a trimmed journal note, clears the draft, and deletes it again", async () => {
    renderTab();
    const textarea = await screen.findByLabelText("New journal note");
    const addButton = screen.getByRole("button", { name: "Add" });

    fireEvent.change(textarea, { target: { value: "   " } });
    expect(addButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "  Reached the second boss  " } });
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);

    expect(await screen.findByText("Reached the second boss")).toBeInTheDocument();
    expect(requestsTo("POST", /\/journal$/)[0]?.body).toEqual({ note: "Reached the second boss" });
    expect(textarea).toHaveValue("");
    expect(screen.queryByText("No journal entries yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete journal entry" }));
    expect(await screen.findByText("No journal entries yet.")).toBeInTheDocument();
    expect(requestsTo("DELETE", /\/journal\/e1$/)).toHaveLength(1);
  });

  it("keeps the draft and shows an error toast when saving a note fails", async () => {
    state.failPostJournal = true;
    renderTab();
    const textarea = await screen.findByLabelText("New journal note");

    fireEvent.change(textarea, { target: { value: "Will not save" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({
        description: "Failed to add journal entry",
        variant: "destructive",
      })
    );
    expect(textarea).toHaveValue("Will not save");
    expect(screen.getByText("No journal entries yet.")).toBeInTheDocument();
  });

  it("adds a milestone with Enter, toggles it complete and back, then deletes it", async () => {
    renderTab();
    const input = await screen.findByLabelText("New milestone label");

    fireEvent.change(input, { target: { value: "Find all relics" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const complete = await screen.findByRole("button", {
      name: 'Mark "Find all relics" complete',
    });
    expect(requestsTo("POST", /\/milestones$/)[0]?.body).toEqual({ label: "Find all relics" });
    expect(input).toHaveValue("");

    fireEvent.click(complete);
    const incomplete = await screen.findByRole("button", {
      name: 'Mark "Find all relics" incomplete',
    });
    expect(requestsTo("PATCH", /\/milestones\/m1$/)[0]?.body).toEqual({ completed: true });
    expect(screen.getByText("Find all relics")).toHaveClass("line-through");

    fireEvent.click(incomplete);
    await screen.findByRole("button", { name: 'Mark "Find all relics" complete' });
    expect(requestsTo("PATCH", /\/milestones\/m1$/)[1]?.body).toEqual({ completed: false });

    fireEvent.click(screen.getByRole("button", { name: 'Delete milestone "Find all relics"' }));
    expect(await screen.findByText("No milestones yet.")).toBeInTheDocument();
  });

  it("ignores Enter on an empty milestone and adds one with the button", async () => {
    renderTab();
    const input = await screen.findByLabelText("New milestone label");
    const addButton = screen.getByRole("button", { name: "Add milestone" });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(addButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "Platinum" } });
    fireEvent.click(addButton);

    expect(await screen.findByText("Platinum")).toBeInTheDocument();
    expect(requestsTo("POST", /\/milestones$/)).toHaveLength(1);
  });

  it("uploads a screenshot, opens it in the lightbox and deletes it from there", async () => {
    renderTab();
    await screen.findByText("No screenshots yet.");

    const fileInput = screen.getByLabelText("Upload screenshot") as HTMLInputElement;
    const file = new File(["png-bytes"], "shot.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const thumbnail = await screen.findByRole("button", { name: "View screenshot 1" });
    const upload = requestsTo("POST", /\/screenshots$/)[0];
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get("file")).toBe(file);
    expect(within(thumbnail).getByRole("img")).toHaveAttribute("src", "/api/screenshots/shot.png");

    fireEvent.click(thumbnail);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByAltText("Game screenshot")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("No screenshots yet.")).toBeInTheDocument();
    expect(requestsTo("DELETE", /\/screenshots\/s1$/)).toHaveLength(1);
  });

  it("uses the screenshot caption as alt text when one is set", async () => {
    state.screenshots = [
      {
        id: "s9",
        filePath: "boss.png",
        caption: "Final boss",
        createdAt: "2026-09-01T10:00:00.000Z",
        url: "/api/screenshots/boss.png",
      },
    ];
    renderTab();

    expect(await screen.findByAltText("Final boss")).toBeInTheDocument();
  });
});
