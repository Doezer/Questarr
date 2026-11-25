import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import {
  AccountSecretRequiredError,
  type AccountAchievements,
  type AccountInput,
} from "./achievement-account.js";
import { AchievementsBusyError, AchievementsUnavailableError } from "./achievement-sync.js";
import type { User } from "../shared/schema.js";

const enabledSchema = z.object({ enabled: z.boolean() }).strict();

export interface AccountRoutesOptions<Input> {
  /** e.g. "/api/retroachievements": status, switch, credentials and sync live under it. */
  basePath: string;
  /** Shown in messages, e.g. "RetroAchievements". */
  label: string;
  account: AccountAchievements;
  /** Validates the body of the credentials request. */
  credentialsSchema: z.ZodType<Input>;
  toSaveInput(input: Input): AccountInput;
  invalidInputMessage: string;
  secretRequiredMessage: string;
  unavailableMessage: string;
  /** The provider refused the secret (400 with the error message). */
  isAuthError(error: unknown): boolean;
  /** The provider could not be reached (502 with the error message). */
  isRequestError(error: unknown): boolean;
}

/** The routes of a provider that signs in with a saved secret (see `achievement-account.ts`). */
export function createAccountRoutes<Input>(options: AccountRoutesOptions<Input>): Router {
  const { basePath, label, account } = options;
  const router = Router();

  router.get(basePath, authenticateToken, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      return res.json(await account.getStatus((req.user as User).id));
    } catch {
      return res.status(500).json({ error: `Could not load the ${label} status.` });
    }
  });

  router.put(
    `${basePath}/credentials`,
    authenticateToken,
    sensitiveEndpointLimiter,
    async (req, res) => {
      const parsed = options.credentialsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: options.invalidInputMessage });
      const userId = (req.user as User).id;
      try {
        await account.saveAccount(userId, options.toSaveInput(parsed.data));
        return res.json(await account.getStatus(userId));
      } catch (error) {
        if (error instanceof AccountSecretRequiredError) {
          return res.status(400).json({ error: options.secretRequiredMessage });
        }
        if (options.isAuthError(error)) {
          return res.status(400).json({ error: (error as Error).message });
        }
        if (options.isRequestError(error)) {
          return res.status(502).json({ error: (error as Error).message });
        }
        return res.status(500).json({ error: `Could not save the ${label} account.` });
      }
    }
  );

  router.delete(
    `${basePath}/credentials`,
    authenticateToken,
    sensitiveEndpointLimiter,
    async (req, res) => {
      const userId = (req.user as User).id;
      try {
        await account.clearAccount(userId);
        return res.json(await account.getStatus(userId));
      } catch {
        return res.status(500).json({ error: `Could not remove the ${label} account.` });
      }
    }
  );

  router.put(basePath, authenticateToken, sensitiveEndpointLimiter, async (req, res) => {
    const parsed = enabledSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { enabled: boolean }." });
    const userId = (req.user as User).id;
    try {
      await account.setEnabled(userId, parsed.data.enabled);
      return res.json(await account.getStatus(userId));
    } catch {
      return res.status(500).json({ error: `Could not save the ${label} setting.` });
    }
  });

  router.post(`${basePath}/sync`, authenticateToken, sensitiveEndpointLimiter, async (req, res) => {
    const userId = (req.user as User).id;
    try {
      const status = await account.getStatus(userId);
      if (!status.enabled) {
        return res.status(400).json({ error: `Turn on the ${label} sync first.` });
      }
      const result = await account.sync(userId, { force: true });
      return res.json({ result, status: await account.getStatus(userId) });
    } catch (error) {
      if (error instanceof AchievementsUnavailableError) {
        return res.status(400).json({ error: options.unavailableMessage });
      }
      if (error instanceof AchievementsBusyError) {
        return res.status(409).json({ error: `A ${label} sync is already running.` });
      }
      return res.status(500).json({ error: `Could not sync your ${label} progress.` });
    }
  });

  return router;
}
