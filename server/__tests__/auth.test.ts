import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPassword, comparePassword, generateToken, authenticateToken } from "../auth.js";
import { storage } from "../storage.js";
import jwt from "jsonwebtoken";

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

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("auth Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hashPassword & comparePassword", () => {
    it("should hash a password and be able to compare it", async () => {
      const password = "my_secure_password";
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);

      const isBadMatch = await comparePassword("wrong_password", hash);
      expect(isBadMatch).toBe(false);
    });
  });

  describe("generateToken", () => {
    it("should generate a valid JWT token", async () => {
      (storage.getSystemConfig as any).mockResolvedValue("test-secret-from-db");

      const user = { id: "user123", username: "testuser" } as any;
      const token = await generateToken(user);

      expect(typeof token).toBe("string");

      const decoded = jwt.verify(token, "test-secret-from-db") as any;
      expect(decoded.id).toBe("user123");
      expect(decoded.username).toBe("testuser");
    });
  });

  describe("authenticateToken", () => {
    const mockRequest = (token?: string) => {
      const req = {
        headers: {
          authorization: token ? `Bearer ${token}` : undefined,
        },
        user: undefined,
      } as any;
      return req;
    };

    const mockResponse = () => {
      const res = {} as any;
      res.status = vi.fn().mockReturnValue(res);
      res.json = vi.fn().mockReturnValue(res);
      return res;
    };

    const next = vi.fn();

    it("should return 401 if no token provided", async () => {
      const req = mockRequest();
      const res = mockResponse();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 if user not found", async () => {
      (storage.getSystemConfig as any).mockResolvedValue("test-secret-from-db");
      const token = jwt.sign({ id: "nonexistent", username: "ghost" }, "test-secret-from-db");

      const req = mockRequest(token);
      const res = mockResponse();

      (storage.getUser as any).mockResolvedValue(undefined);

      await authenticateToken(req, res, next);

      expect(storage.getUser).toHaveBeenCalledWith("nonexistent");
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "User not found" });
      expect(next).not.toHaveBeenCalled();
    });

    it("should call next() if token and user are valid", async () => {
      (storage.getSystemConfig as any).mockResolvedValue("test-secret-from-db");
      const token = jwt.sign({ id: "valid_id", username: "valid_user" }, "test-secret-from-db");

      const req = mockRequest(token);
      const res = mockResponse();

      const validUser = { id: "valid_id", username: "valid_user" };
      (storage.getUser as any).mockResolvedValue(validUser);

      await authenticateToken(req, res, next);

      expect(req.user).toEqual(validUser);
      expect(next).toHaveBeenCalled();
    });

    it("should return 403 on invalid signature", async () => {
      (storage.getSystemConfig as any).mockResolvedValue("test-secret-from-db");
      const maliciousToken = jwt.sign({ id: "valid_id" }, "wrong-secret");

      const req = mockRequest(maliciousToken);
      const res = mockResponse();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
    });
  });
});
