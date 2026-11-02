export type SteamImportOutcome = "added" | "duplicate" | "not_found" | "failed";

export interface SteamImportResult {
  steamAppId: number;
  title: string;
  outcome: SteamImportOutcome;
}

export interface SteamLibraryJobView {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  added: number;
  duplicates: number;
  skipped: number;
  failed: number;
  canRetry: boolean;
  completedAppIds: number[];
  recentResults: SteamImportResult[];
  message?: string;
}
