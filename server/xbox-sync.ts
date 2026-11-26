import { z } from "zod";
import { createAccountAchievements, type AccountStatus } from "./achievement-account.js";
import { fetchXboxTitles, matchXboxGame, verifyXboxKey, XboxAuthError } from "./xbox.js";
import type { ProgressSummary } from "./achievement-sync.js";
import type { Game } from "../shared/schema.js";

/**
 * Xbox provider of the achievement sync (see `achievement-sync.ts`), through an OpenXBL key the
 * user saves in Settings. A library game is matched to an Xbox title by title and device.
 */

export const XBOX_PROVIDER_ID = "xbox";

export const xboxCredentialsSchema = z
  .object({
    /** Left out to keep the saved key. */
    apiKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{16,128}$/)
      .optional(),
  })
  .strict();

const account = createAccountAchievements({
  id: XBOX_PROVIDER_ID,
  label: "Xbox",
  failureMessage: "Could not read your Xbox achievements. Check the OpenXBL API key.",
  credentialsKey: (userId) => `xbox.credentials.${userId}`,
  stateKey: (userId) => `xbox.achievements.${userId}`,
  isAuthError: (error) => error instanceof XboxAuthError,

  // The account name is the gamertag the key belongs to.
  verify: ({ secret }) => verifyXboxKey(secret),

  async read({ secret }, tracked) {
    const titles = await fetchXboxTitles(secret);
    const entries: { game: Game; summary: ProgressSummary }[] = [];
    const dropped: string[] = [];
    for (const game of tracked) {
      const match = matchXboxGame(game, titles);
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
          lastUnlockedAt: null,
        },
      });
    }
    return { entries, dropped };
  },
});

export const xboxAccount = account;
export type XboxStatus = AccountStatus;
