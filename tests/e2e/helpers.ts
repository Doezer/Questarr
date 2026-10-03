import type { Page } from "@playwright/test";

/**
 * Add a game straight through the API, so journeys that are about what happens
 * to a game in the library don't depend on IGDB being reachable. State-changing
 * requests need the double-submit CSRF header the browser client sends.
 */
export async function seedGame(
  page: Page,
  game: { title: string; igdbId: number; status?: string }
): Promise<{ id: string; title: string }> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "questarr_csrf")?.value ?? "";
  const response = await page.request.post("/api/games", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      title: game.title,
      igdbId: game.igdbId,
      status: game.status ?? "wanted",
      platforms: ["PC (Microsoft Windows)"],
      genres: ["Adventure"],
      releaseDate: "2020-01-15",
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Seeding "${game.title}" failed: ${response.status()} ${await response.text()}`
    );
  }
  return (await response.json()) as { id: string; title: string };
}

/** A per-run id so a re-run against the same database never collides with earlier data. */
export function uniqueId(): number {
  return 900_000 + Math.floor(Math.random() * 99_999);
}

/** Update user settings directly, including the CSRF header required by mutations. */
export async function patchUserSettings(
  page: Page,
  updates: Record<string, unknown>
): Promise<void> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === "questarr_csrf")?.value ?? "";
  const response = await page.request.patch("/api/settings", {
    headers: { "X-CSRF-Token": csrf },
    data: updates,
  });
  if (!response.ok()) {
    throw new Error(`Updating settings failed: ${response.status()} ${await response.text()}`);
  }
}
