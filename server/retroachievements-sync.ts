import { z } from "zod";
import { storage } from "./storage.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";
import {
  fetchRetroAchievementsProgress,
  matchRetroAchievementsGame,
  RetroAchievementsAuthError,
  verifyRetroAchievementsCredentials,
} from "./retroachievements.js";
import {
  AchievementsBusyError,
  AchievementsUnavailableError,
  getAchievementsStatus,
  resetAchievementsRun,
  runScheduledAchievementsSync,
  setAchievementsEnabled,
  syncAchievements,
  type AchievementProvider,
  type AchievementsResult,
  type AchievementsStatus,
  type ProgressSummary,
} from "./achievement-sync.js";
import { OWNED_GAME_STATUSES, type Game } from "../shared/schema.js";

/**
 * RetroAchievements provider of the achievement sync (see `achievement-sync.ts`).
 *
 * The user saves a RetroAchievements username and Web API key (Settings, from the RetroAchievements
 * control panel). The key is stored encrypted and never returned by the API. A library game is
 * matched to a RetroAchievements game by title and console, so a PC game that shares a title with
 * a retro game is not mixed up with it.
 */

export const RETROACHIEVEMENTS_PROVIDER_ID = "retroachievements";

export const credentialsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.-]+$/),
    /** Left out to keep the saved key (renaming the account only). */
    apiKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{16,128}$/)
      .optional(),
  })
  .strict();

const stored = z.object({ username: z.string().min(1), apiKey: z.string().min(1) });
type Credentials = z.infer<typeof stored>;

const credentialsKey = (userId: string) => `retroachievements.credentials.${userId}`;

/** The saved username and (decrypted) key, or null when none are saved or the key is unreadable. */
export async function getRetroAchievementsCredentials(userId: string): Promise<Credentials | null> {
  const raw = await storage.getSystemConfig(credentialsKey(userId));
  if (!raw) return null;
  try {
    const parsed = stored.parse(JSON.parse(raw));
    const apiKey = await decryptCredential(parsed.apiKey);
    return apiKey ? { username: parsed.username, apiKey } : null;
  } catch {
    // Do not log the value: a key that no longer decrypts counts as not saved.
    return null;
  }
}

export const retroAchievementsProvider: AchievementProvider = {
  id: RETROACHIEVEMENTS_PROVIDER_ID,
  label: "RetroAchievements",
  failureMessage:
    "Could not read your RetroAchievements progress. Check the username and Web API key.",
  stateKey: (userId) => `retroachievements.achievements.${userId}`,

  async isAvailable(userId) {
    return (await getRetroAchievementsCredentials(userId)) !== null;
  },

  async identity(userId) {
    return (await getRetroAchievementsCredentials(userId))?.username.toLowerCase() ?? null;
  },

  async scheduledUserIds() {
    const ids: string[] = [];
    for (const user of await storage.getAllUsers()) {
      if (await getRetroAchievementsCredentials(user.id)) ids.push(user.id);
    }
    return ids;
  },

  async collect(userId, games) {
    const credentials = await getRetroAchievementsCredentials(userId);
    if (!credentials) return { entries: [], failed: 0 };
    const tracked = games.filter(
      (g) => g.status === "playing" || OWNED_GAME_STATUSES.has(g.status)
    );
    let progress;
    try {
      progress = await fetchRetroAchievementsProgress(credentials.username, credentials.apiKey);
    } catch (error) {
      // The request URL holds the key: report the failure without the error.
      return {
        entries: [],
        failed: error instanceof RetroAchievementsAuthError ? 1 : tracked.length,
      };
    }
    const entries: { game: Game; summary: ProgressSummary }[] = [];
    for (const game of tracked) {
      const match = matchRetroAchievementsGame(game, progress);
      if (!match) continue;
      entries.push({
        game,
        summary: {
          unlocked: match.unlocked,
          total: match.total,
          rarestName: null,
          rarestPercent: null,
          lastUnlockedAt: match.lastUnlockedAt,
        },
      });
    }
    return { entries, failed: 0 };
  },
};

export interface RetroAchievementsStatus extends AchievementsStatus {
  username: string | null;
}

export async function getRetroAchievementsStatus(userId: string): Promise<RetroAchievementsStatus> {
  const [status, credentials] = await Promise.all([
    getAchievementsStatus(retroAchievementsProvider, userId),
    getRetroAchievementsCredentials(userId),
  ]);
  return { ...status, username: credentials?.username ?? null };
}

export class RetroAchievementsKeyRequiredError extends Error {}

/**
 * Save the username and key after the API accepted them. A different account drops the stored
 * progress, so the new account starts from a fresh baseline instead of notifying the difference.
 */
export async function saveRetroAchievementsCredentials(
  userId: string,
  input: z.infer<typeof credentialsSchema>
): Promise<void> {
  const current = await getRetroAchievementsCredentials(userId);
  const apiKey = input.apiKey ?? current?.apiKey;
  if (!apiKey) throw new RetroAchievementsKeyRequiredError();
  await verifyRetroAchievementsCredentials(input.username, apiKey);
  await storage.setSystemConfig(
    credentialsKey(userId),
    JSON.stringify({ username: input.username, apiKey: await encryptCredential(apiKey) })
  );
  if (current && current.username.toLowerCase() !== input.username.toLowerCase()) {
    await storage.deleteAchievementProgress(userId, RETROACHIEVEMENTS_PROVIDER_ID);
    await resetAchievementsRun(retroAchievementsProvider, userId);
  }
}

/** Forget the account: credentials, switch and stored progress. */
export async function clearRetroAchievements(userId: string): Promise<void> {
  await storage.setSystemConfig(credentialsKey(userId), "");
  await setAchievementsEnabled(retroAchievementsProvider, userId, false);
  await storage.deleteAchievementProgress(userId, RETROACHIEVEMENTS_PROVIDER_ID);
}

export const setRetroAchievementsEnabled = (userId: string, enabled: boolean) =>
  setAchievementsEnabled(retroAchievementsProvider, userId, enabled);

export const syncRetroAchievements = (
  userId: string,
  options?: { force?: boolean; now?: Date }
): Promise<AchievementsResult> => syncAchievements(retroAchievementsProvider, userId, options);

export const runScheduledRetroAchievementsSync = () =>
  runScheduledAchievementsSync(retroAchievementsProvider);

export { AchievementsBusyError, AchievementsUnavailableError };
