import { afterEach, describe, expect, it } from "vitest";
import {
  getIndexerCooldownMs,
  IndexerCoolingDownError,
  IndexerRateLimitedError,
  noteIndexerRateLimited,
  parseRetryAfter,
  getIndexerTimeoutMs,
  getMaxConcurrentPerIndexer,
  guardedIndexerSearch,
  resetSearchGuard,
} from "../search-guard.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  resetSearchGuard();
  delete process.env.SEARCH_INDEXER_TIMEOUT_MS;
  delete process.env.SEARCH_MAX_CONCURRENT_PER_INDEXER;
});

describe("guardedIndexerSearch", () => {
  it("shares one request between identical in-flight searches", async () => {
    const gate = deferred<string>();
    let calls = 0;
    const run = () => {
      calls++;
      return gate.promise;
    };
    const a = guardedIndexerSearch("idx", "q", {}, run);
    const b = guardedIndexerSearch("idx", "q", {}, run);
    await Promise.resolve();
    gate.resolve("ok");
    expect(await Promise.all([a, b])).toEqual(["ok", "ok"]);
    expect(calls).toBe(1);
  });

  it("runs a different query as its own request", async () => {
    let calls = 0;
    const run = async () => ++calls;
    await Promise.all([
      guardedIndexerSearch("idx", "a", {}, run),
      guardedIndexerSearch("idx", "b", {}, run),
    ]);
    expect(calls).toBe(2);
  });

  it("caps concurrent searches per indexer and starts the next when one ends", async () => {
    process.env.SEARCH_MAX_CONCURRENT_PER_INDEXER = "2";
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let running = 0;
    let peak = 0;
    const searches = gates.map((gate, i) =>
      guardedIndexerSearch("idx", `q${i}`, {}, async () => {
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
      })
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(running).toBe(2);
    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(running).toBe(2);
    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(searches);
    expect(peak).toBe(2);
  });

  it("does not limit one indexer because of another, nor background by interactive", async () => {
    process.env.SEARCH_MAX_CONCURRENT_PER_INDEXER = "1";
    const gate = deferred<void>();
    let started = 0;
    const run = async () => {
      started++;
      await gate.promise;
    };
    const all = [
      guardedIndexerSearch("a", "q", {}, run),
      guardedIndexerSearch("b", "q", {}, run),
      guardedIndexerSearch("a", "q2", { priority: "background" }, run),
    ];
    await new Promise((r) => setTimeout(r, 5));
    expect(started).toBe(3);
    gate.resolve();
    await Promise.all(all);
  });

  it("aborts the request once its only caller leaves", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const pending = guardedIndexerSearch("idx", "q", { signal: controller.signal }, (signal) => {
      requestSignal = signal;
      return new Promise<string>(() => undefined);
    });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps a shared request alive while another caller still waits", async () => {
    const gate = deferred<string>();
    const first = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const run = (signal: AbortSignal) => {
      requestSignal = signal;
      return gate.promise;
    };
    const a = guardedIndexerSearch("idx", "q", { signal: first.signal }, run);
    const b = guardedIndexerSearch("idx", "q", {}, run);
    await Promise.resolve();
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(false);
    gate.resolve("done");
    expect(await b).toBe("done");
  });

  it("drops a search still waiting in line when its caller leaves", async () => {
    process.env.SEARCH_MAX_CONCURRENT_PER_INDEXER = "1";
    const gate = deferred<void>();
    const controller = new AbortController();
    let secondStarted = false;
    const first = guardedIndexerSearch("idx", "q1", {}, () => gate.promise);
    const second = guardedIndexerSearch("idx", "q2", { signal: controller.signal }, async () => {
      secondStarted = true;
    });
    await Promise.resolve();
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    gate.resolve();
    await first;
    expect(secondStarted).toBe(false);
  });

  it("rejects at once when the caller is already gone", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      guardedIndexerSearch("idx", "q", { signal: controller.signal }, async () => 1)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("search guard settings", () => {
  it("reads the timeout and the concurrency from the environment, clamped", () => {
    expect(getIndexerTimeoutMs()).toBe(30_000);
    expect(getMaxConcurrentPerIndexer()).toBe(2);
    process.env.SEARCH_INDEXER_TIMEOUT_MS = "90000";
    process.env.SEARCH_MAX_CONCURRENT_PER_INDEXER = "99";
    expect(getIndexerTimeoutMs()).toBe(90_000);
    expect(getMaxConcurrentPerIndexer()).toBe(10);
    process.env.SEARCH_INDEXER_TIMEOUT_MS = "abc";
    expect(getIndexerTimeoutMs()).toBe(30_000);
  });
});

describe("per-indexer timeout", () => {
  it("prefers the indexer's own timeout, clamped, over the global one", () => {
    process.env.SEARCH_INDEXER_TIMEOUT_MS = "20000";
    expect(getIndexerTimeoutMs({ timeoutSeconds: 5 })).toBe(5_000);
    expect(getIndexerTimeoutMs({ timeoutSeconds: 9999 })).toBe(300_000);
    expect(getIndexerTimeoutMs({ timeoutSeconds: null })).toBe(20_000);
    expect(getIndexerTimeoutMs()).toBe(20_000);
  });
});

describe("429 backoff", () => {
  it("parses Retry-After as seconds or HTTP date", () => {
    expect(parseRetryAfter("12")).toBe(12_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("garbage")).toBeNull();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:01:00 GMT", now)).toBe(60_000);
  });

  it("honours Retry-After, else backs off exponentially up to a cap", () => {
    expect(noteIndexerRateLimited("a", 90_000, 0)).toBe(90_000);
    expect(noteIndexerRateLimited("b", null, 0)).toBe(30_000);
    expect(noteIndexerRateLimited("b", null, 0)).toBe(60_000);
    for (let i = 0; i < 10; i++) noteIndexerRateLimited("b", null, 0);
    expect(noteIndexerRateLimited("b", null, 0)).toBe(15 * 60_000);
  });

  it("does not shorten a longer active cooldown when a shorter 429 follows", () => {
    noteIndexerRateLimited("idx", 3_600_000, 0);
    noteIndexerRateLimited("idx", 30_000, 1_000);
    expect(getIndexerCooldownMs("idx", 2_000)).toBe(3_600_000 - 2_000);
  });

  it("rejects without calling the indexer while cooling down, and recovers after a success", async () => {
    let calls = 0;
    const limited = () => {
      calls++;
      return Promise.reject(new IndexerRateLimitedError("429", 60_000));
    };
    await expect(guardedIndexerSearch("idx", "q1", {}, limited)).rejects.toThrow("429");
    expect(getIndexerCooldownMs("idx")).toBeGreaterThan(0);
    await expect(guardedIndexerSearch("idx", "q2", {}, limited)).rejects.toBeInstanceOf(
      IndexerCoolingDownError
    );
    expect(calls).toBe(1);
  });

  it("keeps a cooldown set by a 429 that arrived while another search was in flight", async () => {
    const gate = deferred<string>();
    const slow = guardedIndexerSearch("idx", "slow", {}, () => gate.promise);
    await Promise.resolve();
    await expect(
      guardedIndexerSearch("idx", "limited", {}, () =>
        Promise.reject(new IndexerRateLimitedError("429", 60_000))
      )
    ).rejects.toThrow("429");
    gate.resolve("ok");
    await slow;
    expect(getIndexerCooldownMs("idx")).toBeGreaterThan(0);
  });

  it("sees a 429 wrapped as the cause of another error", async () => {
    const wrapped = () =>
      Promise.reject(
        new Error("Failed to search", { cause: new IndexerRateLimitedError("429", null) })
      );
    await expect(guardedIndexerSearch("idx", "q", {}, wrapped)).rejects.toThrow("Failed");
    expect(getIndexerCooldownMs("idx")).toBeGreaterThan(0);
    expect(getIndexerCooldownMs("other")).toBe(0);
  });
});
