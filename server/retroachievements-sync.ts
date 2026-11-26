import { z } from "zod";
import {
  AccountSecretRequiredError,
  createAccountAchievements,
  type AccountStatus,
} from "./achievement-account.js";
import {
  fetchRetroAchievementsProgress,
  matchRetroAchievementsGame,
  RetroAchievementsAuthError,
  verifyRetroAchievementsCredentials,
} from "./retroachievements.js";
import { AchievementsBusyError, AchievementsUnavailableError } from "./achievement-sync.js";
import type { AchievementsResult } from "./achievement-sync.js";
import type { Game } from "../shared/schema.js";
import type { ProgressSummary } from "./achievement-sync.js";

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

const account = createAccountAchievements({
  id: RETROACHIEVEMENTS_PROVIDER_ID,
  label: "RetroAchievements",
  failureMessage:
    "Could not read your RetroAchievements progress. Check the username and Web API key.",
  credentialsKey: (userId) => `retroachievements.credentials.${userId}`,
  stateKey: (userId) => `retroachievements.achievements.${userId}`,
  isAuthError: (error) => error instanceof RetroAchievementsAuthError,

  async verify({ username, secret }) {
    if (!username) throw new RetroAchievementsAuthError();
    await verifyRetroAchievementsCredentials(username, secret);
    return username;
  },

  async read({ username, secret }, tracked) {
    const progress = await fetchRetroAchievementsProgress(username, secret);
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
    return { entries, dropped };
  },
});

export const retroAchievementsProvider = account.provider;

/** The shared account handling, for the routes. */
export const getRetroAchievementsAccount = () => account;

/** The saved username and (decrypted) key, or null when none are saved or the key is unreadable. */
export async function getRetroAchievementsCredentials(
  userId: string
): Promise<{ username: string; apiKey: string } | null> {
  const credentials = await account.getCredentials(userId);
  return credentials ? { username: credentials.username, apiKey: credentials.secret } : null;
}

export type RetroAchievementsStatus = AccountStatus;

export const getRetroAchievementsStatus = (userId: string): Promise<RetroAchievementsStatus> =>
  account.getStatus(userId);

export { AccountSecretRequiredError as RetroAchievementsKeyRequiredError };

export const saveRetroAchievementsCredentials = (
  userId: string,
  input: z.infer<typeof credentialsSchema>
): Promise<void> => account.saveAccount(userId, { username: input.username, secret: input.apiKey });

export const clearRetroAchievements = (userId: string) => account.clearAccount(userId);

export const setRetroAchievementsEnabled = (userId: string, enabled: boolean) =>
  account.setEnabled(userId, enabled);

export const syncRetroAchievements = (
  userId: string,
  options?: { force?: boolean; now?: Date }
): Promise<AchievementsResult> => account.sync(userId, options);

export const runScheduledRetroAchievementsSync = () => account.runScheduled();

export { AchievementsBusyError, AchievementsUnavailableError };
