import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "./storage.js";
import { routesLogger } from "./logger.js";
import {
  customFormatInputSchema,
  releaseProfileInputSchema,
  toFormatSpecs,
  type User,
} from "../shared/schema.js";
import {
  BUILT_IN_RULES,
  BUILT_IN_RULE_IDS,
  validateFormatSpec,
  type FormatSpec,
} from "../shared/release-scoring.js";
import {
  ensureScoringConfig,
  formatFromRow,
  installDefaultFormats,
  profileFromRow,
} from "./release-scoring-service.js";

const router = Router();

const builtInIds = new Set<string>(BUILT_IN_RULE_IDS);

function invalid(res: Response, error: z.ZodError, message: string): Response {
  return res.status(400).json({ error: message, details: error.issues });
}

function specProblem(specs: FormatSpec[]): string | null {
  for (const spec of specs) {
    const problem = validateFormatSpec(spec);
    if (problem) return problem;
  }
  return null;
}

async function currentConfig(userId: string) {
  await ensureScoringConfig(userId);
  const [profile, formats] = await Promise.all([
    storage.getReleaseProfile(userId),
    storage.getCustomFormats(userId),
  ]);
  return {
    profile: profile ? profileFromRow(profile) : null,
    formats: formats.map(formatFromRow),
    // size_mismatch needs an expected size that no search path supplies yet, so it is hidden
    // rather than offered as a setting that changes nothing
    builtInRules: BUILT_IN_RULES.filter((rule) => rule.id !== "size_mismatch").map(
      ({ id, label, points, locked, rejection }) => ({
        id,
        label,
        points,
        locked: locked === true,
        rejects: rejection !== undefined,
      })
    ),
  };
}

router.get("/api/release-scoring", async (req: Request, res: Response) => {
  try {
    res.json(await currentConfig((req.user as User).id));
  } catch (error) {
    routesLogger.error({ error }, "error loading release scoring");
    res.status(500).json({ error: "Failed to load release scoring" });
  }
});

router.put("/api/release-profile", async (req: Request, res: Response) => {
  try {
    const userId = (req.user as User).id;
    const input = releaseProfileInputSchema.parse(req.body);
    const unknownRule = Object.keys(input.builtInOverrides).find((id) => !builtInIds.has(id));
    if (unknownRule) {
      return res.status(400).json({ error: `Unknown built-in rule: ${unknownRule}` });
    }
    await ensureScoringConfig(userId);
    const saved = await storage.saveReleaseProfile(userId, {
      ...input,
      builtInOverrides: input.builtInOverrides,
    });
    return res.json(profileFromRow(saved));
  } catch (error) {
    if (error instanceof z.ZodError) return invalid(res, error, "Invalid release profile");
    routesLogger.error({ error }, "error saving release profile");
    return res.status(500).json({ error: "Failed to save release profile" });
  }
});

router.post("/api/custom-formats", async (req: Request, res: Response) => {
  try {
    const userId = (req.user as User).id;
    const parsed = customFormatInputSchema.parse(req.body);
    const specs = toFormatSpecs(parsed.specs);
    const problem = specProblem(specs);
    if (problem) return res.status(400).json({ error: problem });
    await ensureScoringConfig(userId);
    const row = await storage.createCustomFormat(userId, { ...parsed, specs });
    return res.status(201).json(formatFromRow(row));
  } catch (error) {
    if (error instanceof z.ZodError) return invalid(res, error, "Invalid custom format");
    routesLogger.error({ error }, "error creating custom format");
    return res.status(500).json({ error: "Failed to create custom format" });
  }
});

router.post("/api/custom-formats/install-defaults", async (req: Request, res: Response) => {
  try {
    const added = await installDefaultFormats((req.user as User).id);
    return res.status(201).json({ added });
  } catch (error) {
    routesLogger.error({ error }, "error installing default custom formats");
    return res.status(500).json({ error: "Failed to install recommended formats" });
  }
});

router.patch("/api/custom-formats/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req.user as User).id;
    const parsed = customFormatInputSchema.partial().parse(req.body);
    // partial() keeps the schema defaults, which would reset fields the client did not send
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sent = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => Object.prototype.hasOwnProperty.call(body, key))
    ) as typeof parsed;
    const { specs: parsedSpecs, ...rest } = sent;
    const specs = parsedSpecs ? toFormatSpecs(parsedSpecs) : undefined;
    const problem = specs ? specProblem(specs) : null;
    if (problem) return res.status(400).json({ error: problem });
    const row = await storage.updateCustomFormat(userId, String(req.params.id), {
      ...rest,
      ...(specs ? { specs } : {}),
    });
    if (!row) return res.status(404).json({ error: "Custom format not found" });
    return res.json(formatFromRow(row));
  } catch (error) {
    if (error instanceof z.ZodError) return invalid(res, error, "Invalid custom format");
    routesLogger.error({ error }, "error updating custom format");
    return res.status(500).json({ error: "Failed to update custom format" });
  }
});

router.delete("/api/custom-formats/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req.user as User).id;
    const id = String(req.params.id);
    const removed = await storage.deleteCustomFormat(userId, id);
    if (!removed) return res.status(404).json({ error: "Custom format not found" });
    // a deleted format must not leave a score override behind
    const profile = await storage.getReleaseProfile(userId);
    if (profile && id in profile.formatScores) {
      const { [id]: _removed, ...formatScores } = profile.formatScores;
      await storage.saveReleaseProfile(userId, { ...profileFromRow(profile), formatScores });
    }
    return res.status(204).end();
  } catch (error) {
    routesLogger.error({ error }, "error deleting custom format");
    return res.status(500).json({ error: "Failed to delete custom format" });
  }
});

export const releaseScoringRoutes = router;
