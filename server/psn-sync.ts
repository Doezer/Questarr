import { z } from "zod";
import { createAccountAchievements, type AccountStatus } from "./achievement-account.js";
import { fetchPsnTrophyTitles, matchPsnGame, PsnAuthError, verifyPsnToken } from "./psn.js";
import type { ProgressSummary } from "./achievement-sync.js";
import type { Game } from "../shared/schema.js";

/**
 * PlayStation provider of the achievement sync (see `achievement-sync.ts`). The user saves the
 * NPSSO token of their PlayStation session (Settings); trophies are read per trophy set, so the
 * progress of a game is its trophies earned out of all the trophies of the set.
 */

export const PSN_PROVIDER_ID = "psn";

export const psnCredentialsSchema = z
  .object({
    /** Left out to keep the saved token. NPSSO tokens are 64 letters and digits. */
    npsso: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{32,128}$/)
      .optional(),
  })
  .strict();

const account = createAccountAchievements({
  id: PSN_PROVIDER_ID,
  label: "PlayStation",
  failureMessage:
    "Could not read your PlayStation trophies. Sign in to PlayStation again and save a new NPSSO token.",
  credentialsKey: (userId) => `psn.credentials.${userId}`,
  stateKey: (userId) => `psn.achievements.${userId}`,
  isAuthError: (error) => error instanceof PsnAuthError,

  // The account name is the PlayStation account id the token belongs to.
  verify: ({ secret }) => verifyPsnToken(secret),

  async read({ secret }, tracked) {
    const titles = await fetchPsnTrophyTitles(secret);
    const entries: { game: Game; summary: ProgressSummary }[] = [];
    const dropped: string[] = [];
    for (const game of tracked) {
      const match = matchPsnGame(game, titles);
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
          lastUnlockedAt: match.unlocked > 0 ? match.lastUpdatedAt : null,
        },
      });
    }
    return { entries, dropped };
  },
});

export const psnAccount = account;
export type PsnStatus = AccountStatus;
