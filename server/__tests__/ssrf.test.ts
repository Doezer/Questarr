import { describe, it, expect } from "vitest";
import { isSafeUrl } from "../ssrf";

describe("isSafeUrl Security Check", () => {
  it("should allow valid safe URLs", async () => {
    expect(await isSafeUrl("http://google.com")).toBe(true);
    expect(await isSafeUrl("http://127.0.0.1")).toBe(true);
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
