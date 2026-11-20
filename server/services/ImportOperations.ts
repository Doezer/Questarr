import { randomUUID } from "node:crypto";

export type ImportOperationPhase =
  "queued" | "hashing" | "scanning" | "extracting" | "transferring" | "complete" | "failed";

export type ImportOperationStatus = "running" | "completed" | "failed";

export interface ImportOperation {
  id: string;
  downloadId: string;
  userId: string | null;
  status: ImportOperationStatus;
  phase: ImportOperationPhase;
  /** Bytes read so far in the current phase (hashing); null when not measurable. */
  bytesProcessed: number | null;
  bytesTotal: number | null;
  error: string | null;
  /** The failure needs a password to extract the archive. */
  passwordRequired: boolean;
  /** The scan could not examine everything; confirming again imports it anyway. */
  incompleteScan: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface ImportProgress {
  setPhase(phase: ImportOperationPhase): void;
  setBytes(processed: number, total: number | null): void;
}

/** How long a finished operation stays queryable (page reload / reconnect). */
const FINISHED_TTL_MS = 60 * 60 * 1000;

/**
 * In-memory registry of manual-import operations. Progress is transient by nature, so
 * nothing is persisted: a restart drops running operations, and the download keeps its
 * own status (it stays in manual review until the import succeeds).
 */
export class ImportOperationRegistry {
  private readonly operations = new Map<string, ImportOperation>();

  create(downloadId: string, userId: string | null): ImportOperation {
    this.prune();
    const now = Date.now();
    const op: ImportOperation = {
      id: randomUUID(),
      downloadId,
      userId,
      status: "running",
      phase: "queued",
      bytesProcessed: null,
      bytesTotal: null,
      error: null,
      passwordRequired: false,
      incompleteScan: false,
      startedAt: now,
      updatedAt: now,
    };
    this.operations.set(op.id, op);
    return op;
  }

  get(id: string, userId?: string | null): ImportOperation | undefined {
    const op = this.operations.get(id);
    if (!op) return undefined;
    if (userId !== undefined && op.userId !== userId) return undefined;
    return { ...op };
  }

  /** Most recent operation for a download, for restoring progress after a reload. */
  latestForDownload(downloadId: string, userId?: string | null): ImportOperation | undefined {
    this.prune();
    let latest: ImportOperation | undefined;
    for (const op of this.operations.values()) {
      if (op.downloadId !== downloadId) continue;
      if (userId !== undefined && op.userId !== userId) continue;
      if (!latest || op.startedAt >= latest.startedAt) latest = op;
    }
    return latest ? { ...latest } : undefined;
  }

  progressFor(id: string): ImportProgress {
    const update = (patch: Partial<ImportOperation>) => {
      const op = this.operations.get(id);
      if (!op || op.status !== "running") return;
      Object.assign(op, patch, { updatedAt: Date.now() });
    };
    return {
      setPhase: (phase) => update({ phase, bytesProcessed: null, bytesTotal: null }),
      setBytes: (processed, total) => update({ bytesProcessed: processed, bytesTotal: total }),
    };
  }

  complete(id: string): void {
    const op = this.operations.get(id);
    if (!op) return;
    Object.assign(op, {
      status: "completed",
      phase: "complete",
      updatedAt: Date.now(),
    } satisfies Partial<ImportOperation>);
  }

  fail(
    id: string,
    error: string,
    flags: { passwordRequired?: boolean; incompleteScan?: boolean } = {}
  ): void {
    const op = this.operations.get(id);
    if (!op) return;
    Object.assign(op, {
      status: "failed",
      phase: "failed",
      error,
      passwordRequired: !!flags.passwordRequired,
      incompleteScan: !!flags.incompleteScan,
      updatedAt: Date.now(),
    } satisfies Partial<ImportOperation>);
  }

  private prune(): void {
    const cutoff = Date.now() - FINISHED_TTL_MS;
    for (const [id, op] of this.operations) {
      if (op.status !== "running" && op.updatedAt < cutoff) this.operations.delete(id);
    }
  }
}

export const importOperations = new ImportOperationRegistry();
