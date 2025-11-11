import { type User, type InsertUser, type Game, type InsertGame } from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Game methods
  getAllGames(): Promise<Game[]>;
  getGame(id: string): Promise<Game | undefined>;
  createGame(game: InsertGame): Promise<Game>;
  updateGame(id: string, updates: Partial<InsertGame>): Promise<Game | undefined>;
  deleteGame(id: string): Promise<boolean>;
  getGamesByStatus(status: string): Promise<Game[]>;
  searchGames(query: string): Promise<Game[]>;
  getGamesByPlatform(platform: string): Promise<Game[]>;
  
  // Health check
  checkHealth(): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private games: Map<string, Game>;

  constructor() {
    this.users = new Map();
    this.games = new Map();
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Add some sample games for development
    const sampleGames: InsertGame[] = [
      {
        title: "Elder Scrolls: Legendary Edition",
        description: "Epic fantasy RPG with endless adventures",
        genre: "Action RPG",
        coverImage: "/api/placeholder/300/400",
        releaseDate: "2024-03-15",
        rating: "9.2",
        platforms: ["PC", "PlayStation"],
        status: "owned",
        externalId: "sample-1"
      },
      {
        title: "Cyber Assault: Future Wars",
        description: "Fast-paced sci-fi shooter",
        genre: "FPS",
        coverImage: "/api/placeholder/300/400",
        releaseDate: "2024-06-20",
        rating: "8.5",
        platforms: ["PC", "Xbox"],
        status: "wishlist",
        externalId: "sample-2"
      },
      {
        title: "Neon Speed Racing",
        description: "High-octane racing through neon-lit cities",
        genre: "Racing",
        coverImage: "/api/placeholder/300/400",
        releaseDate: "2024-01-10",
        rating: "7.8",
        platforms: ["PC", "PlayStation", "Xbox"],
        status: "playing",
        externalId: "sample-3"
      },
      {
        title: "Pixel Adventure Quest",
        description: "Charming indie puzzle platformer",
        genre: "Puzzle Platformer", 
        coverImage: "/api/placeholder/300/400",
        releaseDate: "2023-11-05",
        rating: "8.9",
        platforms: ["PC", "Switch", "Mobile"],
        status: "completed",
        externalId: "sample-4"
      }
    ];

    sampleGames.forEach(game => {
      const id = randomUUID();
      const fullGame: Game = {
        ...game,
        id,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.games.set(id, fullGame);
    });
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Game methods
  async getAllGames(): Promise<Game[]> {
    return Array.from(this.games.values());
  }

  async getGame(id: string): Promise<Game | undefined> {
    return this.games.get(id);
  }

  async createGame(insertGame: InsertGame): Promise<Game> {
    const id = randomUUID();
    const game: Game = {
      ...insertGame,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.games.set(id, game);
    return game;
  }

  async updateGame(id: string, updates: Partial<InsertGame>): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game) return undefined;

    const updatedGame: Game = {
      ...game,
      ...updates,
      updatedAt: new Date()
    };
    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async deleteGame(id: string): Promise<boolean> {
    return this.games.delete(id);
  }

  async getGamesByStatus(status: string): Promise<Game[]> {
    return Array.from(this.games.values()).filter(game => game.status === status);
  }

  async searchGames(query: string): Promise<Game[]> {
    const searchTerm = query.toLowerCase();
    return Array.from(this.games.values()).filter(game =>
      game.title.toLowerCase().includes(searchTerm) ||
      game.genre.toLowerCase().includes(searchTerm) ||
      (game.description && game.description.toLowerCase().includes(searchTerm))
    );
  }

  async getGamesByPlatform(platform: string): Promise<Game[]> {
    return Array.from(this.games.values()).filter(game =>
      game.platforms.includes(platform)
    );
  }

  async checkHealth(): Promise<boolean> {
    try {
      // For in-memory storage, just check if the data structures are accessible
      return this.games !== undefined && this.users !== undefined;
    } catch (error) {
      return false;
    }
  }
}

export const storage = new MemStorage();
