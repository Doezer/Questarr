import type { Classification, ClassificationFlag } from "../../shared/release-classification.js";
import type { ReleaseType } from "../../shared/typesafe-types.js";
import type { ReleaseAnalysis } from "../typesafe.js";
import type { CloudInput, ReleaseClassifier } from "./types.js";

/** Jev's release types onto the classes; what the classes cannot express becomes a flag. */
const CLOUD_TYPE_MAP: Record<
  ReleaseType,
  { class: Classification["class"]; flags?: ClassificationFlag[] }
> = {
  full_game: { class: "full_game" },
  repack: { class: "full_game", flags: ["repack"] },
  dlc: { class: "dlc" },
  update: { class: "patch" },
  crack_only: { class: "unknown", flags: ["crack_only"] },
  demo: { class: "unknown", flags: ["demo"] },
  soundtrack: { class: "unknown", flags: ["soundtrack"] },
  other: { class: "unknown", flags: ["other_artifact"] },
  unknown: { class: "unknown" },
};

export interface CloudClassification extends Classification {
  /** Jev's size plausibility, when the answer carried one. Not part of the class. */
  legitimacyScore?: number | null;
}

/**
 * The cloud layer over an existing provider client (TypeSafe's Jev today). The provider only
 * has to implement `analyzeRelease`, so a compatible Decision API model is a configuration
 * change on that client, not a second implementation. An answer that is missing, out of range
 * or below `acceptThreshold` resolves to `unknown`.
 */
export function cloudClassifier(
  provider: {
    analyzeRelease(params: {
      releaseName: string;
      sizeBytes?: number | undefined;
      platform?: string | undefined;
    }): Promise<ReleaseAnalysis | null>;
  },
  acceptThreshold: number,
  modelVersion: () => string
): ReleaseClassifier {
  return {
    async classify(input: CloudInput): Promise<CloudClassification> {
      // The size judgment is independent of the type answer, so an unresolved type keeps it
      const unavailable = (
        reason: string,
        legitimacyScore?: number | null
      ): CloudClassification => ({
        class: "unknown",
        confidence: null,
        source: "cloud",
        modelVersion: modelVersion(),
        ruleIds: [reason],
        ...(legitimacyScore !== undefined ? { legitimacyScore } : {}),
      });
      const analysis = await provider.analyzeRelease({
        releaseName: input.title,
        sizeBytes: input.sizeBytes,
        platform: input.platform,
      });
      if (!analysis) return unavailable("cloud.unavailable");
      const mapped = analysis.releaseType ? CLOUD_TYPE_MAP[analysis.releaseType] : undefined;
      if (!mapped) return unavailable("cloud.invalid-answer", analysis.legitimacyScore);
      const confidence = analysis.releaseTypeConfidence;
      if (confidence === null || confidence < acceptThreshold) {
        return { ...unavailable("cloud.low-confidence", analysis.legitimacyScore), confidence };
      }
      return {
        class: mapped.class,
        confidence,
        source: "cloud",
        modelVersion: modelVersion(),
        legitimacyScore: analysis.legitimacyScore,
        ...(mapped.flags ? { flags: mapped.flags } : {}),
      };
    },
  };
}
