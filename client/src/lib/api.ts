import { type Game, type InsertGame } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { type Platform } from "@/components/PlatformBadge";

const API_BASE = "/api";

// Game API functions
export const gameAPI = {
  // Get all games
  getAll: async (): Promise<Game[]> => {
    const response = await fetch(`${API_BASE}/games`);
    if (!response.ok) throw new Error("Failed to fetch games");
    return response.json();
  },

  // Get games by status
  getByStatus: async (status: string): Promise<Game[]> => {
    const response = await fetch(`${API_BASE}/games/status/${status}`);
    if (!response.ok) throw new Error("Failed to fetch games by status");
    return response.json();
  },

  // Search games
  search: async (query: string): Promise<Game[]> => {
    const response = await fetch(`${API_BASE}/games/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Failed to search games");
    return response.json();
  },

  // Get games by platform
  getByPlatform: async (platform: string): Promise<Game[]> => {
    const response = await fetch(`${API_BASE}/games/platform/${platform}`);
    if (!response.ok) throw new Error("Failed to fetch games by platform");
    return response.json();
  },

  // Get single game
  getById: async (id: string): Promise<Game> => {
    const response = await fetch(`${API_BASE}/games/${id}`);
    if (!response.ok) throw new Error("Failed to fetch game");
    return response.json();
  },

  // Create game
  create: async (gameData: InsertGame): Promise<Game> => {
    const response = await fetch(`${API_BASE}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gameData),
    });
    if (!response.ok) throw new Error("Failed to create game");
    return response.json();
  },

  // Update game
  update: async (id: string, updates: Partial<InsertGame>): Promise<Game> => {
    const response = await fetch(`${API_BASE}/games/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error("Failed to update game");
    return response.json();
  },

  // Update game status
  updateStatus: async (id: string, status: GameStatus): Promise<Game> => {
    const response = await fetch(`${API_BASE}/games/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error("Failed to update game status");
    return response.json();
  },

  // Delete game
  delete: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/games/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete game");
  },
};

// Stats API
export const statsAPI = {
  get: async () => {
    const response = await fetch(`${API_BASE}/stats`);
    if (!response.ok) throw new Error("Failed to fetch stats");
    return response.json();
  },
};

// Discovery API (IGDB)
export const discoveryAPI = {
  search: async (query: string, limit: number = 20) => {
    const response = await fetch(`${API_BASE}/discover/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!response.ok) throw new Error("Failed to search games");
    return response.json();
  },

  popular: async (limit: number = 20) => {
    const response = await fetch(`${API_BASE}/discover/popular?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch popular games");
    return response.json();
  },

  recent: async (limit: number = 20) => {
    const response = await fetch(`${API_BASE}/discover/recent?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch recent games");
    return response.json();
  },

  upcoming: async (limit: number = 20) => {
    const response = await fetch(`${API_BASE}/discover/upcoming?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch upcoming games");
    return response.json();
  },

  addToCollection: async (gameData: InsertGame): Promise<Game> => {
    const response = await fetch(`${API_BASE}/games/add-from-igdb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gameData),
    });
    if (!response.ok) throw new Error("Failed to add game to collection");
    return response.json();
  },
};