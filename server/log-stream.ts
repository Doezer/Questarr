export interface ConsumedLogChunk {
  lines: string[];
  remainder: string;
}

export function consumeLogChunk(chunk: string | Buffer, remainder = ""): ConsumedLogChunk {
  const combined = remainder + chunk.toString();
  const parts = combined.split(/\r?\n/);
  const nextRemainder = parts.pop() ?? "";
  const lines = parts.map((line) => line.trim()).filter((line) => line.length > 0);

  return {
    lines,
    remainder: nextRemainder,
  };
}

export function flushLogRemainder(remainder: string): string | null {
  const line = remainder.trim();
  return line.length > 0 ? line : null;
}
