import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isSafeUrl, safeFetch, resolveSafeAddress } from "../ssrf";
import dns from "dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import type { LookupFunction } from "net";

// Mock dns module
vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

// Mock undici's fetch/Agent for the plain-HTTP path, which pins the TCP
// connection to a validated IP via a custom dns lookup instead of rewriting
// the request URL/Host (see server/ssrf.ts fetchValidatedOnce).
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    fetch: vi.fn(),
    Agent: vi.fn(),
  };
});

type AgentOptions = { connect?: { lookup?: LookupFunction } };

function capturedLookup(): LookupFunction {
  const options = vi.mocked(Agent).mock.calls[0][0] as AgentOptions;
  const lookup = options.connect?.lookup;
  expect(lookup).toBeDefined();
  return lookup as LookupFunction;
}

describe("isSafeUrl Security Check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should allow private IPs by default (self-hosted posture)", async () => {
    // Mock DNS lookup for google.com to return a safe IP
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 },
    ]);
    expect(await isSafeUrl("http://google.com")).toBe(true);

    // Private IPs are allowed by default
    expect(await isSafeUrl("http://127.0.0.1")).toBe(true);
    expect(await isSafeUrl("http://192.168.1.1")).toBe(true);
    expect(await isSafeUrl("http://10.0.0.1")).toBe(true);

    // Mock DNS lookup for localhost
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(await isSafeUrl("http://localhost")).toBe(true);

    expect(await isSafeUrl("http://[::1]")).toBe(true); // Localhost IPv6
  });

  it("should allow private IPs when allowPrivate is true", async () => {
    expect(await isSafeUrl("http://127.0.0.1", { allowPrivate: true })).toBe(true);
    expect(await isSafeUrl("http://192.168.1.1", { allowPrivate: true })).toBe(true);
    expect(await isSafeUrl("http://10.0.0.1", { allowPrivate: true })).toBe(true);
    expect(await isSafeUrl("http://[::1]", { allowPrivate: true })).toBe(true);
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
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 }, // safe
      { address: "127.0.0.1", family: 4 }, // unsafe if allowPrivate: false
    ]);

    expect(await isSafeUrl("http://rebinding-attack.com", { allowPrivate: false })).toBe(false);
  });

  it("should block hostnames that resolve to metadata service regardless of allowPrivate", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect(await isSafeUrl("http://meta-attack.com")).toBe(false);
  });

  it("should reject hostnames that resolve to empty addresses array", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce(
      []
    );
    expect(await isSafeUrl("http://empty-dns.com")).toBe(false);
  });

  it("should allow magnet links without DNS validation (no SSRF risk)", async () => {
    expect(
      await isSafeUrl("magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test+Game")
    ).toBe(true);
    expect(
      await isSafeUrl(
        "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test+Game&tr=http://tracker.example.com/announce"
      )
    ).toBe(true);
    // DNS lookup should not be called for magnet links
    expect(dns.lookup).not.toHaveBeenCalled();
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
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 },
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await safeFetch("https://example.com/api");

    // For HTTPS, should use the original URL (not rewritten to IP)
    expect(fetch).toHaveBeenCalledWith("https://example.com/api", expect.any(Object));
  });

  it("should pin the connection to the resolved IP while preserving the original Host", async () => {
    // Mock DNS lookup to return a safe IP
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 },
    ]);
    vi.mocked(undiciFetch).mockResolvedValueOnce(new Response("ok") as never);

    await safeFetch("http://example.com/api");

    // The request URL/hostname must stay untouched so the upstream server still
    // sees the real Host header — only the underlying TCP connection is pinned.
    expect(undiciFetch).toHaveBeenCalledWith(
      "http://example.com/api",
      expect.objectContaining({ dispatcher: expect.anything() })
    );

    // The dispatcher pins the connection to the DNS-validated IP via a custom
    // lookup, rather than rewriting the URL to the IP.
    const lookup = capturedLookup();
    const callback = vi.fn();
    lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "142.250.185.46", family: 4 }]);
  });

  it("should reject URLs that resolve to metadata service IPs", async () => {
    // Mock DNS lookup to return a metadata service IP
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(safeFetch("https://evil.example.com/")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("should revalidate redirect targets before following them", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "142.250.185.46", family: 4 }, // NOSONAR
    ]);
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 }, // NOSONAR
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://metadata-redirect.example.com/" },
      })
    );

    await expect(safeFetch("https://example.com/download")).rejects.toThrow(
      "Invalid or unsafe URL"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should reject URLs that fail DNS resolution", async () => {
    // Mock DNS lookup to fail
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockRejectedValueOnce(
      new Error("ENOTFOUND")
    );

    await expect(safeFetch("https://non-existent-domain.com/")).rejects.toThrow(
      "Failed to resolve hostname"
    );
  });

  it("should allow private IPs by default for HTTPS", async () => {
    // Direct IP URL (no DNS lookup needed)
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));
    await safeFetch("https://192.168.1.1:8080/api");
    expect(fetch).toHaveBeenCalledWith("https://192.168.1.1:8080/api", expect.any(Object));
  });

  it("should allow private IPs for HTTPS when allowPrivate is true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await safeFetch("https://192.168.1.1:8080/api", { allowPrivate: true });

    expect(fetch).toHaveBeenCalledWith("https://192.168.1.1:8080/api", expect.any(Object));
  });

  it("should reject if any resolved IP is unsafe (DNS Rebinding prevention)", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(safeFetch("http://attack.com")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("should reject URLs that resolve to empty addresses array", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce(
      []
    );
    await expect(safeFetch("http://empty-dns.com")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("should allow bracketed IPv6 literals for HTTPS", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await safeFetch("https://[::1]:8080/api");

    expect(fetch).toHaveBeenCalledWith("https://[::1]:8080/api", expect.any(Object));
  });

  it("should allow bracketed IPv6 literals for HTTP and preserve the original URL", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(new Response("ok") as never);

    await safeFetch("http://[::1]:8080/api");

    // Original URL is preserved unchanged — the Host header comes from the URL itself.
    expect(undiciFetch).toHaveBeenCalledWith(
      "http://[::1]:8080/api",
      expect.objectContaining({ dispatcher: expect.anything() })
    );

    const lookup = capturedLookup();
    const callback = vi.fn();
    lookup("[::1]", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "::1", family: 6 }]);
  });
});

describe("resolveSafeAddress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns address and family for a safe IP", async () => {
    const result = await resolveSafeAddress("192.168.1.1");
    expect(result).toEqual({ address: "192.168.1.1", family: 4 });
  });

  it("strips IPv6 brackets and returns the bare address", async () => {
    const result = await resolveSafeAddress("[::1]");
    expect(result).toEqual({ address: "::1", family: 6 });
  });

  it("throws for an unsafe IP (link-local) passed directly", async () => {
    await expect(resolveSafeAddress("169.254.169.254")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("resolves a hostname and returns the first address", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
    ]);
    const result = await resolveSafeAddress("example.com");
    expect(result).toEqual({ address: "1.2.3.4", family: 4 });
  });

  it("throws when DNS returns an empty address list", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce(
      []
    );
    await expect(resolveSafeAddress("empty.example.com")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("throws when a resolved address is unsafe", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(resolveSafeAddress("evil.example.com")).rejects.toThrow("Invalid or unsafe URL");
  });

  it("throws a descriptive error when DNS resolution fails", async () => {
    vi.mocked(dns.lookup as unknown as import("node:dns").LookupAddress[]).mockRejectedValueOnce(
      new Error("ENOTFOUND")
    );
    await expect(resolveSafeAddress("no-such-host.example.com")).rejects.toThrow(
      "Failed to resolve hostname: no-such-host.example.com"
    );
  });
});
