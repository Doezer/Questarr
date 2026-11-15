import { describe, it, expect } from "vitest";
import { scrubPii, scrubLogLines, redactSecretText } from "../log-scrub.js";

describe("redactSecretText", () => {
  it("redacts key=value style secrets", () => {
    expect(redactSecretText("apikey=abc123&other=fine")).toBe("apikey=[redacted]&other=fine");
    expect(redactSecretText('password: "hunter2"')).toContain("password=[redacted]");
  });

  it("keeps JSON log lines valid when redacting quoted keys", () => {
    const line =
      '{"level":30,"url":"http://x/api","apiKey":"abc123","protocol":"newznab","password":"a\\"b","n":1}';
    const result = redactSecretText(line);

    expect(result).not.toContain("abc123");
    expect(result).not.toContain('a\\"b');
    expect(JSON.parse(result)).toMatchObject({
      apiKey: "[redacted]",
      password: "[redacted]",
      protocol: "newznab",
      n: 1,
    });
    expect(redactSecretText(result)).toBe(result);
  });

  it("keeps closing delimiters when the secret value is not a string", () => {
    for (const value of ["null", "12345", "true"]) {
      const result = redactSecretText(`{"n":1,"token":${value}}`);
      expect(JSON.parse(result)).toEqual({ n: 1, token: "[redacted]" });
    }
    expect(redactSecretText('["secret=abc"]')).toBe('["secret=[redacted]"]');
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization header was Bearer eyJhbGciOiJIUzI1NiJ9.abc.def";
    expect(redactSecretText(input)).toBe("Authorization header was Bearer [redacted]");
  });

  it("redacts Discord webhook URLs", () => {
    const input = "https://discord.com/api/webhooks/12345/abcdef-token";
    expect(redactSecretText(input)).toBe("[redacted-discord-webhook]");
  });
});

describe("scrubPii", () => {
  it("redacts indexer/downloader API keys alongside PII", () => {
    const input =
      "GET https://indexer.example/api?t=search&apikey=super-secret-key&q=zelda from user@example.com";
    const result = scrubPii(input);

    expect(result).not.toContain("super-secret-key");
    expect(result).toContain("apikey=[redacted]");
    expect(result).toContain("[email]");
  });

  it("redacts a raw password/secret in log text", () => {
    expect(scrubPii("secret=abcdef123456 while syncing indexer")).toBe(
      "secret=[redacted] while syncing indexer"
    );
    expect(scrubPii('login failed for password: "hunter2"')).toContain("password=[redacted]");
  });

  it("scrubLogLines redacts API keys across every line", () => {
    const lines = [
      '{"msg":"testing indexer","url":"https://idx.example/api?apikey=abc123def"}',
      '{"msg":"user login","email":"person@example.com"}',
    ];
    const result = scrubLogLines(lines);

    expect(result).not.toContain("abc123def");
    expect(result).toContain("[email]");
  });

  it("keeps NDJSON valid when a secret phrase with escaped quotes sits inside a string value", () => {
    const lines = [
      String.raw`{"level":50,"msg":"login failed: password: \"hunter2\" rejected"}`,
      String.raw`{"level":50,"msg":"header was apiKey = \"zzz\" here"}`,
      String.raw`{"msg":"secret: \"x\" leaked"}`,
    ];
    for (const line of lines) {
      const out = redactSecretText(line);
      expect(() => JSON.parse(out)).not.toThrow();
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(/hunter2|zzz|"x\\"/);
    }
  });

  it("redacts secrets in a stringified JSON body embedded in a log message", () => {
    const lines = [
      String.raw`{"msg":"body {\"password\":\"hunter2\"} x"}`,
      String.raw`{"msg":"body {\"token\":12345,\"a\":1} x"}`,
    ];
    for (const line of lines) {
      const out = redactSecretText(line);
      expect(() => JSON.parse(out)).not.toThrow();
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(/hunter2|12345/);
    }
  });

  it("redacts quoted secret values that never close, raw and JSON-escaped", () => {
    const raw = [
      'login failed password="hunter2',
      "login failed token='abc123",
      `login failed password="hunter'secret`,
      `login failed token='abc"123`,
    ];
    for (const text of raw) {
      expect(redactSecretText(text)).not.toMatch(/hunter|abc|secret|123/);
    }
    const escaped = [
      String.raw`{"msg":"login failed password=\"hunter2"}`,
      String.raw`{"msg":"login failed token=\'abc123"}`,
      `{"msg":"login failed password='hunter2"}`,
    ];
    for (const line of escaped) {
      const out = redactSecretText(line);
      expect(() => JSON.parse(out)).not.toThrow();
      expect(out).not.toMatch(/hunter2|abc123/);
    }
  });
});
