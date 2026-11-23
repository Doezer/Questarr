import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Lock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface SteamAchievement {
  apiName: string;
  displayName: string;
  description: string | null;
  icon: string;
  iconGray: string;
  hidden: boolean;
  achieved: boolean;
  unlockedAt: number | null;
  globalPercent: number | null;
}

type MissingReason = "not_configured" | "no_steam_app_id" | "no_steam_id" | "private";

interface AchievementsResponse {
  achievements: SteamAchievement[];
  reason?: MissingReason;
}

type Filter = "all" | "unlocked" | "locked";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unlocked", label: "Unlocked" },
  { value: "locked", label: "Locked" },
];

const REASON_TEXT: Record<MissingReason, string> = {
  not_configured: "Add a Steam Web API key in Settings to see your achievements here.",
  no_steam_app_id: "This game is not linked to a Steam app, so there are no achievements to show.",
  no_steam_id: "Save your Steam ID in Settings to see your achievements here.",
  private:
    "Steam did not share your achievements. Set your Steam profile's Game details to public, then reload.",
};

function formatUnlockDate(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

interface GameAchievementsProps {
  readonly gameId: string;
}

/**
 * Steam achievements of a saved game with the unlocked count, a filter and each entry's rarity.
 * Every "nothing to show" case says why, instead of leaving the section empty.
 */
export default function GameAchievements({ gameId }: GameAchievementsProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, isError, refetch } = useQuery<AchievementsResponse>({
    queryKey: [`/api/games/${gameId}/achievements`],
    staleTime: 60_000,
    retry: false,
  });

  const achievements = useMemo(() => data?.achievements ?? [], [data?.achievements]);
  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.achieved).length,
    [achievements]
  );
  const visible = useMemo(() => {
    if (filter === "unlocked") return achievements.filter((a) => a.achieved);
    if (filter === "locked") return achievements.filter((a) => !a.achieved);
    return achievements;
  }, [achievements, filter]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading achievements…</p>;
  }
  if (isError) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Could not load the achievements.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (data?.reason) {
    const needsSettings = data.reason === "not_configured" || data.reason === "no_steam_id";
    return (
      <p className="text-sm text-muted-foreground">
        {REASON_TEXT[data.reason]}{" "}
        {needsSettings && (
          <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
            Open Settings
          </Link>
        )}
      </p>
    );
  }
  if (achievements.length === 0) {
    return <p className="text-sm text-muted-foreground">This game has no Steam achievements.</p>;
  }

  const percent = Math.round((unlockedCount / achievements.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className="mb-1 text-sm tabular-nums">
            <span className="font-medium">
              {unlockedCount}/{achievements.length}
            </span>{" "}
            <span className="text-muted-foreground">unlocked ({percent}%)</span>
          </p>
          <Progress
            value={percent}
            className="h-2 bg-muted"
            aria-label={`${unlockedCount} of ${achievements.length} achievements unlocked`}
          />
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => value && setFilter(value as Filter)}
          aria-label="Filter achievements"
          variant="outline"
          size="sm"
        >
          {FILTERS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} aria-label={`Show ${label.toLowerCase()}`}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {filter} achievements.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visible.map((achievement) => {
            const unlockedOn = formatUnlockDate(achievement.unlockedAt);
            const FallbackIcon = achievement.achieved ? Trophy : Lock;
            const secret = achievement.hidden && !achievement.achieved && !achievement.description;
            return (
              <li key={achievement.apiName}>
                <Card className={achievement.achieved ? "" : "opacity-60"}>
                  <CardContent className="flex items-center gap-3 p-3">
                    {achievement.icon ? (
                      <img
                        src={achievement.achieved ? achievement.icon : achievement.iconGray}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="h-10 w-10 shrink-0 rounded"
                      />
                    ) : (
                      <FallbackIcon
                        className="h-10 w-10 shrink-0 p-2 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{achievement.displayName}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {secret ? "Hidden achievement" : achievement.description}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {achievement.achieved
                          ? unlockedOn
                            ? `Unlocked ${unlockedOn}`
                            : "Unlocked"
                          : "Locked"}
                        {achievement.globalPercent !== null &&
                          ` · ${achievement.globalPercent.toFixed(1)}% of players`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
