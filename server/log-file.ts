import { open, stat } from "node:fs/promises";

const DEFAULT_CHUNK_SIZE = 64 * 1024;

export async function readLastLogLines(logPath: string, limit: number): Promise<string[]> {
  if (limit < 1) {
    return [];
  }

  const fileStat = await stat(logPath);
  if (fileStat.size === 0) {
    return [];
  }

  const fileHandle = await open(logPath, "r");

  try {
    let position = fileStat.size;
    let newlineCount = 0;
    const chunks: Buffer[] = [];

    while (position > 0 && newlineCount <= limit) {
      const chunkStart = Math.max(0, position - DEFAULT_CHUNK_SIZE);
      const chunkLength = position - chunkStart;
      const buffer = Buffer.alloc(chunkLength);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, chunkStart);
      const chunk = bytesRead === chunkLength ? buffer : buffer.subarray(0, bytesRead);

      chunks.unshift(chunk);

      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 10) {
          newlineCount += 1;
        }
      }

      position = chunkStart;
    }

    const content = Buffer.concat(chunks).toString("utf8");
    const rawLines = content.split(/\r?\n/);
    const lines =
      position > 0
        ? rawLines.slice(1).filter((line) => line.trim().length > 0)
        : rawLines.filter((line) => line.trim().length > 0);

    return lines.slice(-limit);
  } finally {
    await fileHandle.close();
  }
}
