import { describe, expect, it } from "vitest";
import { consumeLogChunk, flushLogRemainder } from "../log-stream.js";

describe("log stream chunk handling", () => {
  it("emits each complete line when a chunk contains multiple log entries", () => {
    const result = consumeLogChunk('{"msg":"one"}\n{"msg":"two"}\n');

    expect(result.lines).toEqual(['{"msg":"one"}', '{"msg":"two"}']);
    expect(result.remainder).toBe("");
  });

  it("buffers incomplete lines across chunk boundaries", () => {
    const first = consumeLogChunk('{"msg":"par');
    const second = consumeLogChunk('tial"}\n{"msg":"done"}\n', first.remainder);

    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual(['{"msg":"partial"}', '{"msg":"done"}']);
    expect(second.remainder).toBe("");
  });

  it("flushes a trailing line without a newline on stream end", () => {
    expect(flushLogRemainder('{"msg":"final"}')).toBe('{"msg":"final"}');
    expect(flushLogRemainder("   ")).toBeNull();
  });
});
