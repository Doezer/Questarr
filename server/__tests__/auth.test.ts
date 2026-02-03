import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "../types.js";

// Mock dependencies
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(),
    setSystemConfig: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock("../config.js", () => ({
  config: {
    auth: {
      jwtSecret: "questarr-default-secret-change-me",
    },
  },
}));

// Import modules after mocking
import { hashPassword, comparePassword, generateToken, authenticateToken } from "../auth.js";
import { storage } from "../storage.js";
import { type User } from "../../shared/schema.js";

describe("Auth Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("Password Hashing", () => {
    it("should hash a password correctly", async () => {
      const password = "mysecretpassword";
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash).toHaveLength(60); // bcrypt hash length
      const isValid = await bcrypt.compare(password, hash);
      expect(isValid).toBe(true);
    });

    it("should return true for matching password and hash", async () => {
      const password = "password123";
      const hash = await bcrypt.hash(password, 10);
      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it("should return false for non-matching password", async () => {
      const password = "password123";
      const hash = await bcrypt.hash("differentPassword", 10);
      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(false);
    });
  });

  describe("Token Generation", () => {
    it("should generate a valid JWT token", async () => {
      const user = { id: "user-123", username: "testuser" } as User;
      const token = await generateToken(user);

      expect(typeof token).toBe("string");
      const decoded = jwt.decode(token) as jwt.JwtPayload;
      expect(decoded).toBeTruthy();
      expect(decoded.id).toBe(user.id);
      expect(decoded.username).toBe(user.username);
    });
  });

  describe("Token Authentication Middleware", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let nextFunction: NextFunction;

    beforeEach(() => {
      mockReq = {
        headers: {},
      };
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      nextFunction = vi.fn();
    });

    it("should return 401 if no authorization header", async () => {
      await authenticateToken(mockReq as Request, mockRes as Response, nextFunction);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Authentication required" });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should return 401 if token is missing from header", async () => {
      mockReq.headers = { authorization: "Bearer " }; // Empty token
      await authenticateToken(mockReq as Request, mockRes as Response, nextFunction);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Authentication required" });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should return 403 if token is invalid", async () => {
      mockReq.headers = { authorization: "Bearer invalid-token" };

      await authenticateToken(mockReq as Request, mockRes as Response, nextFunction);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should call next() if token is valid and user exists", async () => {
      // Create a valid token using the module's own generateToken to ensure secret matches
      const user = { id: "user-123", username: "testuser" } as User;
      const token = await generateToken(user);

      mockReq.headers = { authorization: `Bearer ${token}` };

      // Mock storage to return the user
      vi.mocked(storage.getUser).mockResolvedValue(user);

      await authenticateToken(mockReq as Request, mockRes as Response, nextFunction);

      expect(storage.getUser).toHaveBeenCalledWith(user.id);
      expect((mockReq as Request).user).toEqual(user);
      expect(nextFunction).toHaveBeenCalled();
    });

    it("should return 401 if user does not exist", async () => {
      // Create a valid token using the module's own generateToken
      const user = { id: "user-123", username: "testuser" } as User;
      const token = await generateToken(user);

      mockReq.headers = { authorization: `Bearer ${token}` };

      // Mock storage to return undefined (user not found)
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      await authenticateToken(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "User not found" });
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
