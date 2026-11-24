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
  setAchievementsEnabledUnlocked,
  runScheduledAchievementsSync,
  setAchievementsEnabled,
  syncAchievements,
  type AchievementProvider,
  type AchievementsResult,
  type AchievementsStatus,
  type ProgressSummary,
  withCommitLock,
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

/** The saved username, readable even when the key no longer decrypts. */
async function getStoredUsername(userId: string): Promise<string | null> {
  const raw = await storage.getSystemConfig(credentialsKey(userId));
  if (!raw) return null;
  try {
    return stored.shape.username.parse((JSON.parse(raw) as { username?: unknown }).username);
  } catch {
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
    const dropped: string[] = [];
    for (const game of tracked) {
      const match = matchRetroAchievementsGame(game, progress);
      if (!match) {
        dropped.push(game.id);
        continue;
      }
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
    return { entries, failed: 0, dropped };
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

/** Saving and removing the account of one user never overlap, so a removal stays final. */
const accountLocks = new Map<string, Promise<unknown>>();
function withAccountLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const result = (accountLocks.get(userId) ?? Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  accountLocks.set(userId, tail);
  void tail.then(() => {
    if (accountLocks.get(userId) === tail) accountLocks.delete(userId);
  });
  return result;
}

/**
 * Save the username and key after the API accepted them. A different account drops the stored
 * progress, so the new account starts from a fresh baseline instead of notifying the difference.
 * The cleanup runs before the new credentials are written: a failed cleanup leaves the old
 * account saved, and a retry cleans up again.
 */
export function saveRetroAchievementsCredentials(
  userId: string,
  input: z.infer<typeof credentialsSchema>
): Promise<void> {
  return withAccountLock(userId, async () => {
    const current = await getRetroAchievementsCredentials(userId);
    const previousUsername = current?.username ?? (await getStoredUsername(userId));
    const apiKey = input.apiKey ?? current?.apiKey;
    if (!apiKey) throw new RetroAchievementsKeyRequiredError();
    await verifyRetroAchievementsCredentials(input.username, apiKey);
    const accountChanged =
      previousUsername !== null && previousUsername.toLowerCase() !== input.username.toLowerCase();
    const encryptedKey = await encryptCredential(apiKey);
    await withCommitLock(retroAchievementsProvider, userId, async () => {
      if (accountChanged) {
        // The run is invalidated first, so a sync still in flight cannot write the old account back.
        await resetAchievementsRun(retroAchievementsProvider, userId);
        await storage.deleteAchievementProgress(userId, RETROACHIEVEMENTS_PROVIDER_ID);
      }
      await storage.setSystemConfig(
        credentialsKey(userId),
        JSON.stringify({ username: input.username, apiKey: encryptedKey })
      );
    });
  });
}

/** Forget the account: credentials, switch and stored progress. */
export function clearRetroAchievements(userId: string): Promise<void> {
  return withAccountLock(userId, () =>
    withCommitLock(retroAchievementsProvider, userId, async () => {
      // Progress goes first: if its deletion fails the account stays saved and a retry finishes.
      await setAchievementsEnabledUnlocked(retroAchievementsProvider, userId, false);
      // Also invalidates a run that started while the sync was on.
      await resetAchievementsRun(retroAchievementsProvider, userId);
      await storage.deleteAchievementProgress(userId, RETROACHIEVEMENTS_PROVIDER_ID);
      await storage.setSystemConfig(credentialsKey(userId), "");
    })
  );
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
