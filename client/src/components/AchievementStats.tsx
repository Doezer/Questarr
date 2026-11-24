import { Gamepad2, Medal, Trophy } from "lucide-react";
import StatsCard from "@/components/StatsCard";
import { useAchievementProgress } from "@/hooks/use-achievement-progress";

/** Achievement completion across the library, on the Statistics page. Hidden until a sync ran. */
export default function AchievementStats() {
  const { data } = useAchievementProgress();
  const summary = data?.summary;
  if (!summary || summary.games === 0) return null;

  const rarest = summary.rarest;
  return (
    <section aria-labelledby="achievement-stats-title" className="space-y-3">
      <h2 id="achievement-stats-title" className="flex items-center gap-2 text-lg font-semibold">
        <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" />
        Achievements
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard
          title="Achievement rate"
          value={`${summary.completionRate}%`}
          subtitle={`${summary.unlocked} of ${summary.total} unlocked`}
          icon={Trophy}
        />
        <StatsCard
          title="Games tracked"
          value={String(summary.games)}
          subtitle={`${summary.completedGames} at 100%`}
          icon={Gamepad2}
        />
        <StatsCard
          title="Rarest unlock"
          value={rarest?.percent != null ? `${rarest.percent.toFixed(1)}%` : "—"}
          subtitle={rarest ? `${rarest.name ?? "Achievement"} · ${rarest.title}` : "No data yet"}
          icon={Medal}
        />
      </div>
    </section>
  );
}
