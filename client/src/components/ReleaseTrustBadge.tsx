import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ReleaseTrust, TrustLevel, TrustTone } from "@shared/release-trust";

const LEVELS: Record<TrustLevel, { label: string; className: string }> = {
  trusted: {
    label: "Trusted",
    className: "border-emerald-500/50 text-emerald-500",
  },
  unverified: {
    label: "Unverified",
    className: "border-amber-500/50 text-amber-500",
  },
  risky: {
    label: "Risky",
    className: "border-destructive/50 text-destructive",
  },
};

const TONE_CLASSES: Record<TrustTone, string> = {
  good: "text-emerald-500",
  neutral: "text-muted-foreground",
  bad: "text-destructive",
};

/** One trust verdict for a search result; opens the list of reasons behind it. */
export default function ReleaseTrustBadge({
  trust,
  className,
}: Readonly<{ trust: ReleaseTrust; className?: string }>) {
  const level = LEVELS[trust.level];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${level.label} release. Show reasons`}
          className={cn("rounded-full focus-visible:ring-2 focus-visible:ring-ring", className)}
          onClick={(event) => event.stopPropagation()}
        >
          <Badge
            variant="outline"
            className={cn("h-5 gap-1 px-1.5 text-[10px] cursor-pointer", level.className)}
          >
            {level.label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-xs" align="start">
        <p className="font-semibold">{level.label}</p>
        {trust.reasons.length > 0 ? (
          <ul className="space-y-0.5" aria-label="Trust reasons">
            {trust.reasons.map((reason) => (
              <li key={reason.code} className={TONE_CLASSES[reason.tone]}>
                {reason.label}
                {reason.detail ? ` (${reason.detail})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No signal either way.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
