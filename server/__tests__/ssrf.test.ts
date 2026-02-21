import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { isSafeUrl, safeFetch } from "../ssrf";
import dns from "dns/promises";

// Mock dns module
vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

describe("isSafeUrl Security Check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should allow private IPs by default (self-hosted use case)", async () => {
    // Mock DNS lookup for google.com to return a safe IP
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([{ address: "142.250.185.46", family: 4 }]);
    expect(await isSafeUrl("http://google.com")).toBe(true);

    // Private IPs are allowed by default for self-hosted projects
    expect(await isSafeUrl("http://127.0.0.1")).toBe(true);
    expect(await isSafeUrl("http://192.168.1.1")).toBe(true);
    expect(await isSafeUrl("http://10.0.0.1")).toBe(true);

    // Mock DNS lookup for localhost
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await isSafeUrl("http://localhost")).toBe(true);

    expect(await isSafeUrl("http://[::1]")).toBe(true); // Localhost IPv6
  });

  it("should block private IPs when allowPrivate is false", async () => {
    expect(await isSafeUrl("http://127.0.0.1", { allowPrivate: false })).toBe(false);
    expect(await isSafeUrl("http://192.168.1.1", { allowPrivate: false })).toBe(false);
    expect(await isSafeUrl("http://10.0.0.1", { allowPrivate: false })).toBe(false);
    expect(await isSafeUrl("http://[::1]", { allowPrivate: false })).toBe(false);
  });

  it("should block IPv4 metadata service", async () => {
    const isSafe = await isSafeUrl("http://169.254.169.254/latest/meta-data/");
    expect(isSafe).toBe(false);
  });

  it("should block IPv6 metadata service", async () => {
    const isSafe = await isSafeUrl("http://[fd00:ec2::254]/");
    expect(isSafe).toBe(false);
  });

  it("should block IPv4-mapped IPv6 metadata service", async () => {
    const isSafe = await isSafeUrl("http://[::ffff:169.254.169.254]/latest/meta-data/");
    expect(isSafe).toBe(false);
  });

  it("should handle DNS lookup failure gracefully", async () => {
    const isSafe = await isSafeUrl("http://non-existent-domain-xyz-123.com");
    expect(isSafe).toBe(false);
  });

  it("should block hostnames that resolve to both safe and unsafe IPs (DNS Rebinding)", async () => {
    // Mock DNS lookup to return both a safe public IP and an unsafe loopback IP
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 }, // safe
      { address: "127.0.0.1", family: 4 }, // unsafe if allowPrivate: false
    ]);

    expect(await isSafeUrl("http://rebinding-attack.com", { allowPrivate: false })).toBe(false);
  });

  it("should block hostnames that resolve to metadata service regardless of allowPrivate", async () => {
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect(await isSafeUrl("http://meta-attack.com")).toBe(false);
  });

  it("should reject hostnames that resolve to empty addresses array", async () => {
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([]);
    expect(await isSafeUrl("http://empty-dns.com")).toBe(false);
  });
});

describe("safeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use original hostname for HTTPS (SSL certificate compatibility)", async () => {
    // Mock DNS lookup to return a safe IP
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([{ address: "142.250.185.46", family: 4 }]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await safeFetch("https://example.com/api");

    // For HTTPS, should use the original URL (not rewritten to IP)
    expect(fetch).toHaveBeenCalledWith("https://example.com/api", expect.any(Object));
  });

  it("should rewrite HTTP URLs to use resolved IP for DNS rebinding protection", async () => {
    // Mock DNS lookup to return a safe IP
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([{ address: "142.250.185.46", family: 4 }]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await safeFetch("http://example.com/api");

    // For HTTP, should rewrite to use IP address
    expect(fetch).toHaveBeenCalledWith(
      "http://142.250.185.46/api",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    // Verify Host header is set
    const calledHeaders = (fetch as Mock).mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get("Host")).toBe("example.com");
  });

  it("should reject URLs that resolve to metadata service IPs", async () => {
    // Mock DNS lookup to return a metadata service IP
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    await expect(safeFetch("https://evil.example.com/")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("should reject URLs that fail DNS resolution", async () => {
    // Mock DNS lookup to fail
    vi.mocked(dns.lookup as any).mockRejectedValueOnce(new Error("ENOTFOUND"));

    await expect(safeFetch("https://non-existent-domain.com/")).rejects.toThrow(
      "Failed to resolve hostname"
    );
  });

  it("should allow private IPs by default for HTTPS", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    // Direct IP URL (no DNS lookup needed)
    await safeFetch("https://192.168.1.1:8080/api");

    expect(fetch).toHaveBeenCalledWith("https://192.168.1.1:8080/api", expect.any(Object));
  });

  it("should reject if any resolved IP is unsafe (DNS Rebinding prevention)", async () => {
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(safeFetch("http://attack.com")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("should reject URLs that resolve to empty addresses array", async () => {
    vi.mocked(dns.lookup as any).mockResolvedValueOnce([]);
    await expect(safeFetch("http://empty-dns.com")).rejects.toThrow("Invalid or unsafe URL");
  });
});
