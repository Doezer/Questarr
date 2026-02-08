import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isSafeUrl } from "../ssrf";
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

  it("should allow valid safe URLs", async () => {
    // Mock DNS lookup for google.com to return a safe IP
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "142.250.185.46", family: 4 });
    expect(await isSafeUrl("http://google.com")).toBe(true);

    // Direct IPs don't need DNS lookup
    expect(await isSafeUrl("http://127.0.0.1")).toBe(true);

    // Mock DNS lookup for localhost
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "127.0.0.1", family: 4 });
    expect(await isSafeUrl("http://localhost")).toBe(true);

    expect(await isSafeUrl("http://[::1]")).toBe(true); // Localhost IPv6
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
});
