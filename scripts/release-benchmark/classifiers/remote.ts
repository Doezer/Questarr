import type { ReleaseClass } from "../../../shared/release-classification.js";
import { normalizeLabel } from "../dataset.js";
import type { BenchClassifier, LabeledRelease, Prediction } from "../types.js";

const TIMEOUT_MS = 20_000;

/** Error of a row the call cap stopped: no request was sent for it. */
export const BUDGET_EXHAUSTED = "call budget exhausted";

/** Both remote classifiers cap their own calls, so a mistake cannot run up a bill. */
class CallBudget {
  private used = 0;
  constructor(private readonly max: number) {}
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

function failed(message: string, started: number): Prediction {
  return {
    label: "unknown",
    confidence: null,
    latencyMs: performance.now() - started,
    error: message,
  };
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

interface ReportedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

/** What the provider says a call cost; null for anything it did not report. */
const usageOf = (usage: ReportedUsage | undefined) => ({
  costCredits: num(usage?.cost),
  promptTokens: num(usage?.prompt_tokens),
  completionTokens: num(usage?.completion_tokens),
});

// ---------------------------------------------------------------------------
// Jev through TypeSafe's "System One" API (the contract server/typesafe.ts uses)
// ---------------------------------------------------------------------------

export interface JevConfig {
  url: string;
  apiKey: string;
  model: string;
  maxCalls: number;
}

/** Jev's 9 labels onto the ADR's classes (task 1, section 8). */
export function mapJevChoice(choice: string): ReleaseClass | null {
  const mapped = normalizeLabel(choice);
  return mapped ? mapped.label : null;
}

const JEV_CRITERIA = {
  full_game: "A complete, standalone game",
  dlc: "Downloadable content, an expansion, or an add-on for an existing game",
  update: "A patch, update, or hotfix for an existing game",
  repack: "A repacked/compressed release of a full game",
  crack_only: "Just a crack, fix, or bypass -- not the full game",
  demo: "A demo or trial version",
  soundtrack: "A game soundtrack or OST",
  other:
    "Clearly identifiable as some other kind of release (e.g. a mod, trainer, artbook or video) that is none of the above",
  unknown:
    "Not enough information in the release name and metadata to tell which of the above it is",
};

export function jevClassifier(config: JevConfig): BenchClassifier {
  const budget = new CallBudget(config.maxCalls);
  return {
    id: "jev",
    trainable: false,
    remote: true,
    async classify(row: LabeledRelease): Promise<Prediction> {
      const started = performance.now();
      if (!budget.take()) return failed(BUDGET_EXHAUSTED, started);
      try {
        const response = await fetch(config.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            state: `Release name: ${row.releaseName}`,
            model: config.model,
            questions: {
              releaseType: {
                type: "choice",
                instructions: "What kind of release is this, based on its name?",
                criteria: JEV_CRITERIA,
              },
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return failed(`HTTP ${response.status}`, started);
        const data = (await response.json()) as {
          answers?: { releaseType?: { choice?: string; confidence?: number } };
          usage?: ReportedUsage;
        };
        const usage = usageOf(data.usage);
        const answer = data.answers?.releaseType;
        const label = answer?.choice ? mapJevChoice(answer.choice) : null;
        if (!label) {
          return { ...failed(`unusable answer: ${answer?.choice ?? "none"}`, started), ...usage };
        }
        return {
          label,
          confidence: num(answer?.confidence),
          latencyMs: performance.now() - started,
          ...usage,
        };
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error), started);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Any OpenRouter chat model as a Decision API
// ---------------------------------------------------------------------------

export interface OpenRouterConfig {
  model: string;
  apiKey: string;
  maxCalls: number;
  baseUrl?: string;
}

const CHAT_PROMPT = `You label a video game release name (scene, P2P or usenet) for a game manager.
Pick exactly one class:
- full_game: the base game itself, including repacks and editions that contain the base game.
- dlc: any add-on that needs the base game: expansion, story add-on, cosmetic or item pack, season pass, bonus content, DLC unlocker.
- patch: an update, hotfix or version patch.
- unknown: you cannot tell, or it is not a game package (movie, series, soundtrack, trainer, crack only). Prefer unknown over guessing. Never default to full_game.
Answer with JSON only: {"label":"...","confidence":0.0}`;

export function parseChatAnswer(
  text: string
): { label: ReleaseClass; confidence: number | null } | null {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(clean) as { label?: unknown; confidence?: unknown };
    const mapped = typeof parsed.label === "string" ? normalizeLabel(parsed.label) : null;
    return mapped ? { label: mapped.label, confidence: num(parsed.confidence) } : null;
  } catch {
    return null;
  }
}

export function openRouterClassifier(config: OpenRouterConfig): BenchClassifier {
  const budget = new CallBudget(config.maxCalls);
  const url = `${config.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`;
  return {
    id: `openrouter:${config.model}`,
    trainable: false,
    remote: true,
    async classify(row: LabeledRelease): Promise<Prediction> {
      const started = performance.now();
      if (!budget.take()) return failed(BUDGET_EXHAUSTED, started);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Doezer/Questarr",
            "X-Title": "Questarr release benchmark",
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [
              { role: "system", content: CHAT_PROMPT },
              { role: "user", content: `Release name: ${row.releaseName}` },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return failed(`HTTP ${response.status}`, started);
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: ReportedUsage;
        };
        const answer = parseChatAnswer(data.choices?.[0]?.message?.content ?? "");
        const usage = usageOf(data.usage);
        if (!answer) {
          return { ...failed("unparseable answer", started), ...usage };
        }
        return { ...answer, latencyMs: performance.now() - started, ...usage };
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error), started);
      }
    },
  };
}
