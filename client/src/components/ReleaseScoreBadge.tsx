import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ReleaseEvaluation, RejectionCode } from "@shared/release-scoring";

const REJECTION_LABELS: Record<RejectionCode, string> = {
  title_mismatch: "The release is not this game",
  title_sequel: "The release is a sequel",
  non_game_category: "The indexer category is not a game",
  non_game_media: "Looks like a video, music or book release",
  wrong_platform: "Wrong platform",
  required_term_missing: "Missing a required term",
  ignored_term: "Contains an ignored term",
  min_seeders: "Too few seeders",
  max_size: "Larger than the maximum size",
  below_min_score: "Score is below the minimum",
  custom_format_reject: "Rejected by a custom format",
  risky_file: "Executable or script payload",
};

const TITLE_MATCH_LABELS: Record<ReleaseEvaluation["titleMatch"], string> = {
  exact: "Exact title",
  contains: "Contains the title",
  ambiguous: "Ambiguous title",
  spinoff: "Spin-off title",
  sequel: "Sequel",
  mismatch: "Different game",
};

export function formatPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/** Compact score for a search result; opens the breakdown of lines and rejections. */
export default function ReleaseScoreBadge({
  evaluation,
  className,
}: Readonly<{ evaluation: ReleaseEvaluation; className?: string }>) {
  const { accepted, score, lines, rejections, titleMatch } = evaluation;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Score ${score}, ${accepted ? "accepted" : "rejected"}. Show breakdown`}
          className={cn("rounded-full focus-visible:ring-2 focus-visible:ring-ring", className)}
          onClick={(event) => event.stopPropagation()}
        >
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px] font-mono cursor-pointer",
              accepted
                ? "border-emerald-500/50 text-emerald-500"
                : "border-destructive/50 text-destructive"
            )}
          >
            {accepted ? "Score" : "Rejected"} {score}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-xs" align="start">
        <div className="flex items-center justify-between font-semibold">
          <span>{TITLE_MATCH_LABELS[titleMatch]}</span>
          <span className="font-mono">{score}</span>
        </div>
        {rejections.length > 0 && (
          <ul className="space-y-0.5 text-destructive" aria-label="Rejections">
            {rejections.map((rejection) => (
              <li key={`${rejection.code}:${rejection.detail ?? ""}`}>
                {REJECTION_LABELS[rejection.code]}
                {rejection.detail ? ` (${rejection.detail})` : ""}
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 ? (
          <ul className="space-y-0.5" aria-label="Score lines">
            {lines.map((line) => (
              <li key={line.ruleId} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{line.label}</span>
                <span
                  className={cn(
                    "font-mono",
                    line.points < 0 ? "text-destructive" : "text-emerald-500"
                  )}
                >
                  {formatPoints(line.points)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No rule matched this release.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
