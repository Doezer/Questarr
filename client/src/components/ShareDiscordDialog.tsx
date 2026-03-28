import { useState, useRef } from "react";
import { toPng } from "html-to-image";
import { Share2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { LibraryStats } from "@/lib/stats";

interface ShareDiscordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: LibraryStats;
}

const STAT_OPTIONS = [
  { id: "overview" as const, label: "Overview (Total Games, Rating, Completion)" },
  { id: "status" as const, label: "Status Breakdown (Wanted, Owned, Completed, Downloading)" },
  { id: "quickinfo" as const, label: "Quick Info (Top Genre, Platform, Publisher)" },
];

type StatId = "overview" | "status" | "quickinfo";

const STATUS_COLORS: Record<string, string> = {
  Wanted: "#ef4444",
  Owned: "#3b82f6",
  Completed: "#10b981",
  Downloading: "#8b5cf6",
};

export default function ShareDiscordDialog({ open, onOpenChange, stats }: ShareDiscordDialogProps) {
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<StatId>>(
    new Set<StatId>(["overview", "status", "quickinfo"])
  );
  const [sharing, setSharing] = useState(false);

  const toggle = (id: StatId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleShare = async () => {
    if (!cardRef.current || selected.size === 0) return;
    setSharing(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 });
      const res = await apiRequest("POST", "/api/stats/discord-share", {
        image: dataUrl,
        message: "📊 My Questarr library stats",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to share");
      }
      toast({ title: "Shared!", description: "Stats posted to Discord successfully." });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Share failed",
        description: err instanceof Error ? err.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Share to Discord
          </DialogTitle>
          <DialogDescription>Choose which stats to include in the shared image.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {STAT_OPTIONS.map((opt) => (
            <div key={opt.id} className="flex items-center gap-3">
              <Checkbox
                id={`share-${opt.id}`}
                checked={selected.has(opt.id)}
                onCheckedChange={() => toggle(opt.id)}
              />
              <Label htmlFor={`share-${opt.id}`} className="cursor-pointer font-normal">
                {opt.label}
              </Label>
            </div>
          ))}
        </div>

        {/* Off-screen card rendered for image capture */}
        <div style={{ position: "absolute", left: -9999, top: -9999, pointerEvents: "none" }}>
          <div
            ref={cardRef}
            style={{
              width: 580,
              background: "#111827",
              color: "#f9fafb",
              fontFamily: "system-ui, -apple-system, sans-serif",
              padding: "28px 32px",
              borderRadius: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 32 }}>🎮</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Questarr Library Stats</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  {new Date().toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
            </div>

            {selected.has("overview") && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 18,
                }}
              >
                {[
                  { label: "Total Games", value: stats.totalGames },
                  { label: "Avg. Rating", value: stats.avgRating },
                  { label: "Completion", value: `${stats.completionRate}%` },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      background: "#1f2937",
                      borderRadius: 10,
                      padding: "14px 12px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 26, fontWeight: 700, color: "#3b82f6" }}>
                      {item.value}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            )}

            {selected.has("status") && (
              <div style={{ marginBottom: 18 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  Status Breakdown
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  {[
                    {
                      label: "Wanted",
                      value: stats.statusBreakdown.wanted,
                      color: STATUS_COLORS.Wanted,
                    },
                    {
                      label: "Owned",
                      value: stats.statusBreakdown.owned,
                      color: STATUS_COLORS.Owned,
                    },
                    {
                      label: "Completed",
                      value: stats.statusBreakdown.completed,
                      color: STATUS_COLORS.Completed,
                    },
                    {
                      label: "Downloading",
                      value: stats.statusBreakdown.downloading,
                      color: STATUS_COLORS.Downloading,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        background: "#1f2937",
                        borderRadius: 8,
                        padding: "10px 6px",
                        textAlign: "center",
                        borderTop: `3px solid ${item.color}`,
                      }}
                    >
                      <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>
                        {item.value}
                      </div>
                      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                        {item.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.has("quickinfo") && (
              <div style={{ marginBottom: 18 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  Quick Info
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Top Genre", value: stats.topGenre?.name || "N/A" },
                    { label: "Top Platform", value: stats.topPlatform?.name || "N/A" },
                    { label: "Top Publisher", value: stats.topPublisher?.name || "N/A" },
                    { label: "Unique Devs", value: String(stats.uniqueDevelopers) },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        background: "#1f2937",
                        borderRadius: 8,
                        padding: "10px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{item.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                paddingTop: 14,
                borderTop: "1px solid #1f2937",
                textAlign: "center",
                fontSize: 10,
                color: "#6b7280",
              }}
            >
              Shared via Questarr
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sharing}>
            Cancel
          </Button>
          <Button onClick={handleShare} disabled={sharing || selected.size === 0}>
            {sharing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sharing...
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
