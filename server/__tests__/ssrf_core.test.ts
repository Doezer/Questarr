import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { isSafeUrl, safeFetch } from "../ssrf";
import dns from "dns/promises";

// Mock dns
vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

describe("SSRF Core", () => {
  describe("isSafeUrl / isSafeIp", () => {
    // We can test isSafeUrl with mocked dns.lookup

    it("should block private IPv4 range 10.0.0.0/8", async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: "10.0.0.1", family: 4 });
      expect(await isSafeUrl("http://private-internal.com")).toBe(false);
    });

    it("should block private IPv4 range 192.168.0.0/16", async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: "192.168.1.1", family: 4 });
      expect(await isSafeUrl("http://router.local")).toBe(false);
    });

    it("should block loopback 127.0.0.1", async () => {
      expect(await isSafeUrl("http://127.0.0.1")).toBe(false);
    });

    it("should allow public IP 8.8.8.8", async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: "8.8.8.8", family: 4 });
      expect(await isSafeUrl("http://google.com")).toBe(true);
    });
  });

  describe("safeFetch", () => {
    // We need to mock global fetch or ensure safeFetch uses it.
    // safeFetch uses global fetch.
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();

    beforeAll(() => {
      global.fetch = mockFetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    beforeEach(() => {
      mockFetch.mockReset();
      vi.clearAllMocks();
    });

    it("should throw for blocked IP", async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: "10.0.0.5", family: 4 });
      await expect(safeFetch("http://internal.service")).rejects.toThrow("Blocked unsafe IP");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should call fetch with resolved IP and Host header for allowed IP", async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: "93.184.216.34", family: 4 });
      mockFetch.mockResolvedValue({ ok: true } as Response);

      await safeFetch("http://example.com/api");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://93.184.216.34/api",
        expect.objectContaining({
          headers: expect.objectContaining({
            Host: "example.com",
          }),
        })
      );
    });
  });
});
