import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl from "yauzl";

/** Hard limits that keep a hostile or corrupt archive from exhausting memory or disk. */
export const MAX_ZIP_ENTRIES = 200_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024;

export interface ZipEntryInfo {
  name: string;
  size: number;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Reject entry names that could escape the extraction directory or smuggle in
 * something odd: absolute paths, drive letters, backslashes, NUL bytes and any
 * `.` / `..` / empty segment.
 */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("\\")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  const segments = name.replace(/\/$/, "").split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (err, zip) => (err || !zip ? reject(err ?? new Error("Cannot open archive")) : resolve(zip))
    );
  });
}

function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    let uncompressed = 0;
    zip.on("entry", (entry: yauzl.Entry) => {
      if (entries.length >= MAX_ZIP_ENTRIES) {
        reject(new Error("Archive has too many entries"));
        return;
      }
      uncompressed += entry.uncompressedSize;
      if (uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        reject(new Error("Archive is too large once extracted"));
        return;
      }
      const mode = (entry.externalFileAttributes >>> 16) & S_IFMT;
      if (mode === S_IFLNK) {
        reject(new Error(`Archive contains a symbolic link: ${entry.fileName}`));
        return;
      }
      if (!isSafeEntryName(entry.fileName)) {
        reject(new Error(`Archive contains an unsafe path: ${entry.fileName}`));
        return;
      }
      entries.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}

/** List the file entries of an archive, rejecting anything unsafe before a byte is extracted. */
export async function listZipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const zip = await openZip(zipPath);
  try {
    const entries = await readEntries(zip);
    return entries
      .filter((e) => !e.fileName.endsWith("/"))
      .map((e) => ({ name: e.fileName, size: e.uncompressedSize }));
  } finally {
    zip.close();
  }
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) =>
      err || !stream ? reject(err ?? new Error("Cannot read entry")) : resolve(stream)
    );
  });
}

/** Read one small entry into memory (the manifest). */
export async function readZipText(
  zipPath: string,
  entryName: string,
  maxBytes = 1024 * 1024
): Promise<string> {
  const zip = await openZip(zipPath);
  try {
    const entries = await readEntries(zip);
    const entry = entries.find((e) => e.fileName === entryName);
    if (!entry) throw new Error(`Archive has no ${entryName}`);
    if (entry.uncompressedSize > maxBytes) throw new Error(`${entryName} is too large`);
    const stream = await openEntryStream(zip, entry);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > maxBytes) throw new Error(`${entryName} is too large`);
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    zip.close();
  }
}

/**
 * Extract the entries `accept` allows into `destDir`. Every destination is
 * re-checked against the directory, and the bytes actually written are counted
 * so an entry that lies about its size cannot fill the disk.
 */
export async function extractZip(
  zipPath: string,
  destDir: string,
  accept: (name: string) => boolean
): Promise<string[]> {
  const root = path.resolve(destDir);
  const zip = await openZip(zipPath);
  const written: string[] = [];
  try {
    const entries = await readEntries(zip);
    let budget = MAX_ZIP_UNCOMPRESSED_BYTES;
    for (const entry of entries) {
      if (entry.fileName.endsWith("/") || !accept(entry.fileName)) continue;
      const target = path.resolve(root, entry.fileName);
      if (!target.startsWith(root + path.sep)) {
        throw new Error(`Archive entry escapes the target directory: ${entry.fileName}`);
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const stream = await openEntryStream(zip, entry);
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          budget -= chunk.length;
          if (budget < 0) cb(new Error("Archive is too large once extracted"));
          else cb(null, chunk);
        },
      });
      await pipeline(stream, limiter, fs.createWriteStream(target, { mode: 0o600 }));
      written.push(entry.fileName);
    }
    return written;
  } finally {
    zip.close();
  }
}
