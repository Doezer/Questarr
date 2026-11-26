import { describe, it, expect } from "vitest";
import { redactSecrets } from "../security.js";

// `redactSecretText` (the plain-string secret redaction `redactSecrets` is built
// on) now lives in shared/log-scrub.ts, re-exported here for pino-formatter use
// -- its own tests live in shared/__tests__/log-scrub.test.ts. This file covers
// only redactSecrets' server-specific behavior: recursive object/array redaction
// by key shape.
describe("redactSecrets", () => {
  it("redacts values whose key looks secret-shaped", () => {
    const result = redactSecrets({
      apiKey: "abc123",
      client_secret: "xyz789",
      password: "hunter2",
      token: "tok_1",
      title: "My Game",
    });

    expect(result).toEqual({
      apiKey: "[redacted]",
      client_secret: "[redacted]",
      password: "[redacted]",
      token: "[redacted]",
      title: "My Game",
    });
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactSecrets({
      downloader: { name: "qbit", password: "secret-pw" },
      indexers: [
        { name: "idx1", apiKey: "key1" },
        { name: "idx2", apiKey: "key2" },
      ],
    });

    expect(result).toEqual({
      downloader: { name: "qbit", password: "[redacted]" },
      indexers: [
        { name: "idx1", apiKey: "[redacted]" },
        { name: "idx2", apiKey: "[redacted]" },
      ],
    });
  });

  it("redacts secret-shaped substrings inside plain string values too", () => {
    const result = redactSecrets({ message: "used Bearer sekrettoken123 to authenticate" });
    expect(result).toEqual({ message: "used Bearer [redacted] to authenticate" });
  });

  it("passes through primitives and non-secret objects unchanged", () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets({ count: 3, ok: true })).toEqual({ count: 3, ok: true });
  });

  it("summarizes Error objects instead of leaking their full shape", () => {
    const error = new Error("token=abc123 was invalid");
    expect(redactSecrets(error)).toEqual({
      name: "Error",
      message: "token=[redacted] was invalid",
    });
  });

  it("preserves Date values instead of collapsing them to {}", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(redactSecrets(date)).toBe("2026-01-02T03:04:05.000Z");
    expect(redactSecrets({ timestamp: date })).toEqual({
      timestamp: "2026-01-02T03:04:05.000Z",
    });
  });

  it("returns a sentinel for an invalid Date instead of throwing", () => {
    const invalidDate = new Date("not a real date");
    expect(() => redactSecrets(invalidDate)).not.toThrow();
    expect(redactSecrets(invalidDate)).toBe("[Invalid Date]");
  });

  it("summarizes Buffer values instead of collapsing them to {}", () => {
    const buf = Buffer.from("hello");
    expect(redactSecrets(buf)).toBe("[Buffer 5 bytes]");
  });

  it("redacts through Map and Set values instead of collapsing them to {}", () => {
    const map = new Map<string, string>([
      ["username", "alice"],
      ["password", "hunter2"],
    ]);
    expect(redactSecrets(map)).toEqual({ username: "alice", password: "[redacted]" });

    const set = new Set(["plain text", "Bearer sekrettoken123"]);
    expect(redactSecrets(set)).toEqual(["plain text", "Bearer [redacted]"]);
  });
  describe("error serialization", () => {
    it("keeps code, errno, syscall, status and the cause chain", () => {
      const cause = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
        errno: -111,
        syscall: "connect",
      });
      const error = new TypeError("fetch failed", { cause });
      expect(redactSecrets({ error })).toEqual({
        error: {
          name: "TypeError",
          message: "fetch failed",
          cause: {
            name: "Error",
            message: "connect ECONNREFUSED",
            code: "ECONNREFUSED",
            errno: -111,
            syscall: "connect",
          },
        },
      });
      expect(redactSecrets(Object.assign(new Error("nope"), { status: 401 }))).toEqual({
        name: "Error",
        message: "nope",
        status: 401,
      });
    });

    it("serializes error-shaped objects that do not extend Error", () => {
      const lookalike = {
        name: "AbortError",
        message: "aborted",
        stack: "AbortError: aborted\n at x",
      };
      expect(redactSecrets({ err: lookalike })).toEqual({
        err: { name: "AbortError", message: "aborted" },
      });
    });

    it("redacts a secret-shaped name on an error-like object", () => {
      const lookalike = { name: "Bearer sekrettoken123", message: "x", stack: "s" };
      expect(JSON.stringify(redactSecrets({ err: lookalike }))).not.toContain("sekrettoken123");
    });

    it("redacts secrets inside messages and causes and never emits the stack", () => {
      const error = new Error("login failed", { cause: new Error("token=abc123 rejected") });
      const result = JSON.stringify(redactSecrets(error));
      expect(result).not.toContain("abc123");
      expect(result).not.toContain("stack");
    });

    it("does not recurse forever on a circular cause", () => {
      const error = new Error("loop");
      (error as { cause?: unknown }).cause = error;
      expect(() => redactSecrets(error)).not.toThrow();
    });
  });
});
