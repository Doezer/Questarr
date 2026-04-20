import type { Game } from "@shared/schema";

export function getReleaseStatus(game: Game): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  isReleased: boolean;
  className?: string;
} {
  if (game.releaseStatus === "delayed") {
    return { label: "Delayed", variant: "destructive", isReleased: false };
  }

  if (!game.releaseDate) return { label: "TBA", variant: "secondary", isReleased: false };

  const now = new Date();
  const release = new Date(game.releaseDate);

  if (release > now) {
    return { label: "Upcoming", variant: "default", isReleased: false };
  }
  return {
    label: "Released",
    variant: "outline",
    isReleased: true,
    className: "bg-green-500 border-green-600 text-white",
  };
}
