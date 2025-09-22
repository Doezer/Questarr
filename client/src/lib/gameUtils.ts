import { type Game as APIGame } from "@shared/schema";
import { type Game } from "@/components/GameCard";
import { type Platform } from "@/components/PlatformBadge";

// Transform API game to component game format with proper type safety
export const transformGame = (apiGame: APIGame): Game => ({
  ...apiGame,
  platforms: (apiGame.platforms || []).filter((p): p is Platform => 
    ["PC", "PlayStation", "Xbox", "Switch", "Mobile", "VR"].includes(p)
  ),
  rating: apiGame.rating ? parseFloat(apiGame.rating as string) : undefined,
  coverImage: apiGame.coverImage || "/api/placeholder/300/400",
  createdAt: apiGame.createdAt || new Date(),
  updatedAt: apiGame.updatedAt || new Date(),
});

// Calculate days until release with safety checks
export const calculateDaysUntil = (releaseDate: string | null | undefined): number => {
  if (!releaseDate) return 0;
  
  const today = new Date();
  const release = new Date(releaseDate);
  
  // Check if date is valid
  if (isNaN(release.getTime())) return 0;
  
  const diffTime = release.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Format date safely
export const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return "Unknown";
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid Date";
  
  return date.toLocaleDateString();
};