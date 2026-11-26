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

  it("keeps escaped quotes and backslashes inside a secret value from ending the match", () => {
    const nested = JSON.stringify({ msg: JSON.stringify({ password: 'prefix"suffix' }) });
    const spaced = JSON.stringify({ msg: 'password="prefix\\"private tail"' });
    for (const line of [nested, spaced]) {
      const out = redactSecretText(line);
      expect(() => JSON.parse(out)).not.toThrow();
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(/prefix|suffix|private|tail/);
    }
    expect(redactSecretText('password="Pa55\\word!')).not.toMatch(/Pa55|word!/);
    expect(redactSecretText("token='ab}cd")).not.toMatch(/ab|cd/);
  });
});

describe("scrubPii usernames", () => {
  it("masks the username of a failed login line and keeps the line valid JSON", () => {
    const line =
      '{"level":40,"time":1,"module":"routes","username":"jdupont","ip":"203.0.113.9","msg":"Failed login attempt"}';
    const result = scrubPii(line);
    expect(result).not.toContain("jdupont");
    expect(JSON.parse(result)).toMatchObject({
      username: "[user]",
      ip: "[ip:public]",
      msg: "Failed login attempt",
    });
  });

  it("masks downloader usernames in objects, escaped JSON and plain text", () => {
    expect(scrubPii('{"type":"qbittorrent","username":"admin","port":8080}')).toBe(
      '{"type":"qbittorrent","username":"[user]","port":8080}'
    );
    const escaped = scrubPii(String.raw`body {\"username\":\"bob\",\"x\":1}`);
    expect(escaped).not.toContain("bob");
    expect(escaped).toContain(String.raw`\"x\":1`);
    expect(scrubPii("login failed username=alice for host")).toBe(
      "login failed username=[user] for host"
    );
  });

  it("masks an unquoted key with an escaped-quoted value and keeps the line valid JSON", () => {
    const line = JSON.stringify({ msg: 'login failed username="bob smith" now' });
    const result = scrubPii(line);
    expect(result).not.toContain("bob");
    expect(JSON.parse(result).msg).toBe('login failed username="[user]" now');
  });

  it("leaves object and array values under login untouched", () => {
    const line = '{"login":{"id":1},"username":["a"]}';
    expect(scrubPii(line)).toBe(line);
  });

  it("masks brackets inside an unquoted username", () => {
    expect(scrubPii("login username=alice[smith] next=1")).toBe("login username=[user] next=1");
  });

  it("masks plain key=value usernames that start with a bracket", () => {
    expect(scrubPii("login username=[alice] next=1")).toBe("login username=[user] next=1");
  });

  it("masks apostrophes inside an unquoted username", () => {
    expect(scrubPii("login username=O'Connor next=1")).toBe("login username=[user] next=1");
    expect(scrubPii("login username=d'Artagnan'")).toBe("login username=[user]");
  });

  it("stops at an encoded line break in a JSON line but not in plain text", () => {
    const json = JSON.stringify({ msg: "username=alice\nstatus=failed" });
    const result = scrubPii(json);
    expect(JSON.parse(result).msg).toBe("username=[user]\nstatus=failed");

    expect(scrubPii(String.raw`user username=ACME\nancy next=1`)).toBe(
      "user username=[user] next=1"
    );
    expect(scrubPii(String.raw`user username=ACME\tom next=1`)).toBe("user username=[user] next=1");
  });

  it("masks a domain-qualified username entirely", () => {
    expect(scrubPii(String.raw`user username=ACME\alice next=1`)).toBe(
      "user username=[user] next=1"
    );
  });

  it("keeps JSON valid when a message ends with an encoded backslash", () => {
    const line = JSON.stringify({ msg: "login username=alice\\" });
    const result = scrubPii(line);
    expect(result).not.toContain("alice");
    expect(JSON.parse(result).msg).toBe("login username=[user]");
  });

  it("is idempotent", () => {
    const once = scrubPii('{"username":"jdupont","ip":"10.0.0.2"}');
    expect(scrubPii(once)).toBe(once);
  });
});

describe("scrubPii IP classes", () => {
  it.each([
    ["127.0.0.1", "[ip:loopback]"],
    ["10.1.2.3", "[ip:lan]"],
    ["172.16.0.1", "[ip:lan]"],
    ["172.32.0.1", "[ip:public]"],
    ["192.168.1.20", "[ip:lan]"],
    ["169.254.1.1", "[ip:lan]"],
    ["8.8.8.8", "[ip:public]"],
    ["::1", "[ip:loopback]"],
    ["fe80::1", "[ip:lan]"],
    ["fd12:3456:789a::1", "[ip:lan]"],
    ["2001:db8::1", "[ip:public]"],
    ["0:0:0:0:0:0:0:1", "[ip:loopback]"],
    ["0:0:0:0:0:0:0:0", "[ip:lan]"],
    ["fc::1", "[ip:public]"],
    ["fe8::1", "[ip:public]"],
  ])("classifies %s", (ip, expected) => {
    expect(scrubPii(`connect ${ip} failed`)).toBe(`connect ${expected} failed`);
  });

  it("classifies IPv4-mapped IPv6 addresses by their embedded IPv4", () => {
    expect(scrubPii("ip=::ffff:192.168.1.5")).toBe("ip=[ip:lan]");
    expect(scrubPii("ip=::ffff:127.0.0.1,")).toBe("ip=[ip:loopback],");
    expect(scrubPii("ip=::ffff:8.8.8.8")).toBe("ip=[ip:public]");
  });

  it("keeps localhost as is", () => {
    expect(scrubPii("http://localhost:8080/api")).toBe("http://localhost:8080/api");
  });
});
