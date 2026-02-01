
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";

// Mock dependencies
vi.mock("../storage.js", () => ({
    storage: {
        getUserGames: vi.fn(),
        searchUserGames: vi.fn(),
        addGame: vi.fn(),
        removeGame: vi.fn(),
        getUser: vi.fn(),
        getUserByUsername: vi.fn(),
        countUsers: vi.fn(),
        registerSetupUser: vi.fn(),
        setSystemConfig: vi.fn(),
        getSystemConfig: vi.fn(),
        assignOrphanGamesToUser: vi.fn(),
        getUserSettings: vi.fn().mockResolvedValue({}),
        updateGameStatus: vi.fn(),
        updateGameHidden: vi.fn(),
    },
}));

vi.mock("../igdb.js", () => ({
    igdbClient: {
        searchGames: vi.fn(),
        formatGameData: vi.fn((game) => game),
        getPopularGames: vi.fn(),
    },
}));

vi.mock("../auth.js", async () => {
    const actual = await vi.importActual("../auth.js");
    return {
        ...actual,
        authenticateToken: (req: any, res: any, next: any) => {
            req.user = { id: "user-1", username: "testuser" };
            next();
        },
        generateToken: vi.fn().mockResolvedValue("mock-token"),
        comparePassword: vi.fn().mockResolvedValue(true),
        hashPassword: vi.fn().mockResolvedValue("hashed-password"),
    };
});

vi.mock("../db.js", () => ({
    db: {
        select: vi.fn(),
        from: vi.fn(),
        where: vi.fn(),
        get: vi.fn(),
    },
}));

vi.mock("../logger.js", () => ({
    routesLogger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
    },
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
    },
    downloadersLogger: {
        info: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
    }
}));

vi.mock("../rss.js", () => ({
    rssService: {
        start: vi.fn(),
        stop: vi.fn(),
    }
}));

vi.mock("../torznab.js", () => ({
    torznabClient: {}
}));

vi.mock("../prowlarr.js", () => ({
    prowlarrClient: {}
}));

vi.mock("../xrel.js", () => ({
    xrelClient: {}
}));

vi.mock("../downloaders.js", () => ({
    DownloaderManager: {
        initialize: vi.fn(),
    }
}));

describe("API Routes", () => {
    let app: express.Express;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = express();
        app.use(express.json());
        await registerRoutes(app);
    });

    describe("GET /api/games", () => {
        it("should return user games", async () => {
            const mockGames = [
                { id: "game-1", title: "Test Game", userId: "user-1" },
            ];
            (storage.getUserGames as any).mockResolvedValue(mockGames);

            const response = await request(app).get("/api/games");

            expect(response.status).toBe(200);
            expect(response.body).toEqual(mockGames);
            expect(storage.getUserGames).toHaveBeenCalledWith("user-1", false);
        });

        it("should handle search query", async () => {
            const mockGames = [
                { id: "game-1", title: "Test Game", userId: "user-1" }
            ];
            (storage.searchUserGames as any).mockResolvedValue(mockGames);

            const response = await request(app).get("/api/games?search=Test");

            expect(response.status).toBe(200);
            expect(response.body).toEqual(mockGames);
            expect(storage.searchUserGames).toHaveBeenCalledWith("user-1", "Test", false);
        });
    });

    describe("POST /api/games", () => {
        it("should add a new game", async () => {
            const newGame = {
                title: "New Game",
                igdbId: 12345,
                platform: "PC"
            };
            const savedGame = { ...newGame, id: "game-new", userId: "user-1" };

            (storage.getUserGames as any).mockResolvedValue([]); // No existing games
            (storage.addGame as any).mockResolvedValue(savedGame);

            const response = await request(app)
                .post("/api/games")
                .send(newGame);

            expect(response.status).toBe(201);
            expect(response.body).toEqual(savedGame);
            expect(storage.addGame).toHaveBeenCalled();
        });

        it("should prevent duplicate games", async () => {
            const gameData = {
                title: "Duplicate Game",
                igdbId: 100,
                platform: "PC"
            };
            const existingGame = { ...gameData, id: "game-100", userId: "user-1" };

            (storage.getUserGames as any).mockResolvedValue([existingGame]);

            const response = await request(app)
                .post("/api/games")
                .send(gameData);

            expect(response.status).toBe(409);
            expect(response.body.error).toContain("already in collection");
        });
    });

    describe("GET /api/igdb/search", () => {
        it("should return search results", async () => {
            const mockResults = [{ id: 1, name: "Zelda" }];
            (igdbClient.searchGames as any).mockResolvedValue(mockResults);

            const response = await request(app).get("/api/igdb/search?q=Zelda");

            expect(response.status).toBe(200);
            expect(response.body).toEqual(mockResults);
            expect(igdbClient.searchGames).toHaveBeenCalledWith("Zelda", 20);
        });

        it("should require query parameter", async () => {
            const response = await request(app).get("/api/igdb/search");
            expect(response.status).toBe(400);
        });



        describe("PATCH /api/games/:id/status", () => {
            it("should update game status", async () => {
                const gameId = "123e4567-e89b-12d3-a456-426614174000";
                const updatedGame = { id: gameId, status: "completed" };
                (storage.updateGameStatus as any).mockResolvedValue(updatedGame);

                const response = await request(app)
                    .patch(`/api/games/${gameId}/status`)
                    .send({ status: "completed" });

                expect(response.status).toBe(200);
                expect(response.body).toEqual(updatedGame);
                expect(storage.updateGameStatus).toHaveBeenCalledWith(gameId, { status: "completed" });
            });

            it("should return 404 for non-existent game", async () => {
                const gameId = "123e4567-e89b-12d3-a456-426614174099";
                (storage.updateGameStatus as any).mockResolvedValue(null);

                const response = await request(app)
                    .patch(`/api/games/${gameId}/status`)
                    .send({ status: "completed" });

                expect(response.status).toBe(404);
            });
        });
    });

    describe("PATCH /api/games/:id/hidden", () => {
        it("should update hidden status", async () => {
            const gameId = "123e4567-e89b-12d3-a456-426614174000";
            const updatedGame = { id: gameId, hidden: true };
            (storage.updateGameHidden as any).mockResolvedValue(updatedGame);

            const response = await request(app)
                .patch(`/api/games/${gameId}/hidden`)
                .send({ hidden: true });

            expect(response.status).toBe(200);
            expect(response.body).toEqual(updatedGame);
            expect(storage.updateGameHidden).toHaveBeenCalledWith(gameId, true);
        });
    });

    describe("DELETE /api/games/:id", () => {
        it("should remove game", async () => {
            const gameId = "123e4567-e89b-12d3-a456-426614174000";
            (storage.removeGame as any).mockResolvedValue(true);

            const response = await request(app).delete(`/api/games/${gameId}`);

            expect(response.status).toBe(204);
            expect(storage.removeGame).toHaveBeenCalledWith(gameId);
        });

        it("should return 404 if game not found", async () => {
            const gameId = "123e4567-e89b-12d3-a456-426614174099";
            (storage.removeGame as any).mockResolvedValue(false);

            const response = await request(app).delete(`/api/games/${gameId}`);

            expect(response.status).toBe(404);
        });
    });
});
