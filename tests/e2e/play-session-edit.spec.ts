import { test, expect } from "@playwright/test";
import { apiSend, seedGame, uniqueId } from "./helpers";

test.describe("Play session editing (1.7.0)", () => {
  test("edits, splits and merges manual sessions, and refuses invalid input", async ({ page }) => {
    const id = uniqueId();
    await page.goto("/");
    const game = await seedGame(page, {
      title: `Session Quest ${id}`,
      igdbId: id,
      status: "playing",
    });
    const base = `/api/games/${game.id}/play-sessions`;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

    // A 2 hour session and a 1 hour session, entered by hand.
    expect(
      (await apiSend(page, "POST", base, { startedAt: hoursAgo(6), durationMinutes: 120 })).ok()
    ).toBe(true);
    expect(
      (await apiSend(page, "POST", base, { startedAt: hoursAgo(4), durationMinutes: 60 })).ok()
    ).toBe(true);

    await page.goto(`/games/${game.id}`);
    const playtime = page.getByTestId("section-playtime");
    await expect(playtime.getByText("2 sessions")).toBeVisible();
    await expect(playtime.getByTestId("text-playtime-total")).toHaveText("3h");

    // Split the longer session in two from the dialog.
    await playtime.getByRole("button", { name: /^Split the 2h/ }).click();
    const dialog = page.getByRole("dialog", { name: "Split session" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Split" }).click();
    await expect(playtime.getByText("3 sessions")).toBeVisible();
    await expect(playtime.getByTestId("text-playtime-total")).toHaveText("3h");

    // Merge them all back into one.
    for (const box of await playtime.getByRole("checkbox", { name: /to merge$/ }).all()) {
      await box.check();
    }
    await playtime.getByRole("button", { name: "Merge sessions" }).click();
    await expect(playtime.getByText("1 session")).toBeVisible();
    await expect(playtime.getByTestId("text-playtime-total")).toHaveText("3h");

    // Edit the merged session so that it stops two hours after it started.
    await playtime.getByRole("button", { name: /^Edit the 3h/ }).click();
    const edit = page.getByRole("dialog", { name: "Edit session" });
    // Set both ends to whole minutes, so the length is exactly two hours.
    const started = await edit.getByLabel("Started").inputValue();
    const [datePart, timePart] = started.split("T") as [string, string];
    const [y, mo, d] = datePart.split("-").map(Number) as [number, number, number];
    const [h, mi] = timePart.split(":").map(Number) as [number, number];
    const at = (extraMinutes: number) =>
      new Date(Date.UTC(y, mo - 1, d, h, mi + extraMinutes)).toISOString().slice(0, 16);
    await edit.getByLabel("Started").fill(at(1));
    await edit.getByLabel("Stopped").fill(at(121));
    await expect(edit.getByText("Length: 2h")).toBeVisible();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(playtime.getByTestId("text-playtime-total")).toHaveText("2h");
    await page.reload();
    await expect(
      page.getByTestId("section-playtime").getByTestId("text-playtime-total")
    ).toHaveText("2h");

    // Sessions more than 30 minutes apart cannot be merged.
    const far = await apiSend(page, "POST", base, { startedAt: hoursAgo(10), durationMinutes: 30 });
    const farSession = (await far.json()) as { id: string };
    const sessions = (await (await page.request.get(base)).json()) as Array<{ id: string }>;
    const tooFar = await apiSend(page, "POST", `${base}/merge`, {
      sessionIds: [farSession.id, sessions.find((s) => s.id !== farSession.id)!.id],
    });
    expect(tooFar.status()).toBe(400);

    // The API refuses a merge of fewer than two sessions and an unknown session.
    const refused = await apiSend(page, "POST", `${base}/merge`, { sessionIds: [] });
    expect(refused.status()).toBe(400);
    const missing = await apiSend(page, "PATCH", `${base}/00000000-0000-0000-0000-000000000000`, {
      startedAt: hoursAgo(1),
    });
    expect(missing.status()).toBe(404);

    // Statistics ranks the most played games across the whole library, so leave no hours behind.
    expect((await apiSend(page, "DELETE", `/api/games/${game.id}`)).ok()).toBe(true);
  });
});
