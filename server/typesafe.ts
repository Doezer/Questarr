import { logger } from "./logger.js";
import { safeFetch } from "./ssrf.js";
import { storage } from "./storage.js";
import { RELEASE_TYPES, type ReleaseType } from "../shared/typesafe-types.js";

export type { ReleaseType };

const typesafeLogger = logger.child({ module: "typesafe" });

const DEFAULT_API_URL = "https://api.typesafe.ai/v1/systemone";
// TypeSafe's own default model. A user routing through a proxy (e.g. OpenRouter's
// `typesafe/jev-1.13`) needs a different identifier here, so this is configurable too.
const DEFAULT_MODEL = "jev-latest";
const REQUEST_TIMEOUT_MS = 8000;

export const TYPESAFE_URL_CONFIG_KEY = "typesafe.apiUrl";
export const TYPESAFE_KEY_CONFIG_KEY = "typesafe.apiKey";
export const TYPESAFE_MODEL_CONFIG_KEY = "typesafe.model";

export interface ReleaseAnalysis {
  releaseType: ReleaseType | null;
  releaseTypeConfidence: number | null;
  legitimacyScore: number | null; // 0-1 probability the file size looks plausible
}

interface SystemOneAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
}

interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
}

/** Guards against a malformed/out-of-spec API response producing NaN% or negative confidence in the UI. */
function toUnitInterval(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Thin client for TypeSafe's Jev "System One" API. Fully optional (BYOK): Questarr works
 * without it, this only adds AI-assisted release classification and a size-plausibility
 * check when a user supplies their own endpoint + key. The URL is user-configurable (their
 * own TypeSafe key, a compatible proxy, self-host, etc.), so requests always go through
 * safeFetch with requireHttps since an API key credential travels on every call.
 */
class TypeSafeClient {
  private apiUrl: string | null = null;
  private apiKey: string | null = null;
  private model: string = DEFAULT_MODEL;
  private loaded = false;

  /**
   * Set credentials directly (used by the settings route right after a save). Mirrors
   * ensureLoaded()'s fallback: a blank URL with a real key still means "configured",
   * pointed at TypeSafe's default endpoint -- otherwise isConfigured() would incorrectly
   * report false until the next restart re-triggers ensureLoaded()'s own fallback.
   */
  configure(apiUrl: string | null, apiKey: string | null, model?: string | null): void {
    const trimmedKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
    const trimmedUrl = apiUrl && apiUrl.trim().length > 0 ? apiUrl.trim() : null;
    const trimmedModel = model && model.trim().length > 0 ? model.trim() : null;
    this.apiKey = trimmedKey;
    this.apiUrl = trimmedUrl ?? (trimmedKey ? DEFAULT_API_URL : null);
    this.model = trimmedModel ?? DEFAULT_MODEL;
    this.loaded = true;
  }

  /** Forget the cached credentials so the next call re-reads them from storage. */
  invalidate(): void {
    this.loaded = false;
  }

  /** Lazily loads credentials from system_config on first use (they're stored encrypted). */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const [storedUrl, storedKey, storedModel] = await Promise.all([
      storage.getSystemConfig(TYPESAFE_URL_CONFIG_KEY),
      storage.getSystemConfig(TYPESAFE_KEY_CONFIG_KEY),
      storage.getSystemConfig(TYPESAFE_MODEL_CONFIG_KEY),
    ]);
    // Imported lazily (rather than at module scope) so pulling in typesafe.ts doesn't
    // force server/db.ts to initialize in call sites/tests that never actually invoke
    // an AI analysis call and don't mock ./credential-crypto.js or ./db.js themselves.
    const apiKey = storedKey
      ? await (await import("./credential-crypto.js")).decryptCredential(storedKey)
      : null;
    this.apiUrl = storedUrl && storedUrl.trim().length > 0 ? storedUrl.trim() : DEFAULT_API_URL;
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
    this.model = storedModel && storedModel.trim().length > 0 ? storedModel.trim() : DEFAULT_MODEL;
    this.loaded = true;
  }

  async isConfigured(): Promise<boolean> {
    await this.ensureLoaded();
    return !!(this.apiUrl && this.apiKey);
  }

  /**
   * Asks Jev to classify a release and judge whether its file size looks plausible.
   * Returns null if not configured or the call fails/times out -- callers must treat
   * this as a best-effort enrichment, never a blocking dependency.
   */
  async analyzeRelease(params: {
    releaseName: string;
    sizeBytes?: number | undefined;
    platform?: string | undefined;
  }): Promise<ReleaseAnalysis | null> {
    await this.ensureLoaded();
    if (!this.apiUrl || !this.apiKey) return null;

    const stateLines = [`Release name: ${params.releaseName}`];
    if (params.sizeBytes !== undefined) {
      stateLines.push(`File size: ${formatBytes(params.sizeBytes)}`);
    }
    if (params.platform) {
      stateLines.push(`Detected platform: ${params.platform}`);
    }

    const body = {
      state: stateLines.join("\n"),
      model: this.model,
      questions: {
        releaseType: {
          type: "choice",
          instructions: "What kind of release is this, based on its name?",
          criteria: {
            full_game: "A complete, standalone game",
            dlc: "Downloadable content, an expansion, or an add-on for an existing game",
            update: "A patch, update, or hotfix for an existing game",
            repack: "A repacked/compressed release of a full game",
            crack_only: "Just a crack, fix, or bypass -- not the full game",
            demo: "A demo or trial version",
            soundtrack: "A game soundtrack or OST",
            other: "None of the above",
          },
        },
        sizeIsPlausible: {
          type: "noul",
          instructions:
            "The file size is plausible and consistent with a legitimate release of this type, given typical sizes for this kind of game and platform. Answer false if the size looks suspiciously small (e.g. a few MB for what should be a multi-GB game) or otherwise inconsistent with a real release.",
        },
      },
    };

    try {
      const response = await safeFetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
        requireHttps: true,
      });

      if (!response.ok) {
        typesafeLogger.warn(
          { status: response.status },
          "TypeSafe API request failed, skipping AI enrichment for this release"
        );
        return null;
      }

      const data = (await response.json()) as SystemOneResponse;
      const releaseTypeAnswer = data.answers?.releaseType;
      const legitimacyAnswer = data.answers?.sizeIsPlausible;
      const releaseType =
        releaseTypeAnswer?.choice &&
        (RELEASE_TYPES as readonly string[]).includes(releaseTypeAnswer.choice)
          ? (releaseTypeAnswer.choice as ReleaseType)
          : null;

      return {
        releaseType,
        releaseTypeConfidence: toUnitInterval(releaseTypeAnswer?.confidence),
        legitimacyScore: toUnitInterval(legitimacyAnswer?.noul),
      };
    } catch (error) {
      typesafeLogger.warn({ error }, "TypeSafe API call failed, skipping AI enrichment");
      return null;
    }
  }
}

export const typesafeClient = new TypeSafeClient();
