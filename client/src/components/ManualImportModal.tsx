import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileBrowser } from "./FileBrowser";
import type { Game, ImportConfig, ImportTransferMode } from "@shared/schema";

interface ScannedFile {
  name: string;
  path: string;
  size: number;
  isDirectory: false;
}

type ImportCategory = "main" | "dlc" | "update" | "packs" | "extra";

interface ImportAssignment {
  file: ScannedFile;
  gameId: string;
  gameTitle: string;
  category: ImportCategory;
  platformDir: string;
}

interface ManualImportResult {
  filePath: string;
  success: boolean;
  error?: string | undefined;
}

const CATEGORY_OPTIONS: Array<{ value: ImportCategory; label: string }> = [
  { value: "main", label: "Main game" },
  { value: "dlc", label: "DLC" },
  { value: "update", label: "Update" },
  { value: "packs", label: "Packs / add-ons" },
  { value: "extra", label: "Extra" },
];

const TRANSFER_MODES: Array<{ value: ImportTransferMode; label: string }> = [
  { value: "move", label: "Move" },
  { value: "copy", label: "Copy" },
  { value: "hardlink", label: "Hardlink" },
  { value: "symlink", label: "Symlink" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export default function ManualImportModal({
  open,
  onOpenChange,
  game,
  defaultCategory,
  contentId,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game?: Game;
  defaultCategory?: ImportCategory;
  contentId?: number;
}>) {
  const { toast } = useToast();
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [assignments, setAssignments] = useState<ImportAssignment[]>([]);
  const [transferMode, setTransferMode] = useState<ImportTransferMode | "">("");
  const [scanLoading, setScanLoading] = useState(false);
  const [step, setStep] = useState<"scan" | "assign">("scan");
  const sourceSelectedRef = useRef(false);

  const { data: userGames = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    enabled: open && !game,
  });
  const { data: platformFolders = [] } = useQuery<string[]>({
    queryKey: ["/api/platform-folders"],
    enabled: open && !game,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const { data: importConfig } = useQuery<ImportConfig>({
    queryKey: ["/api/imports/config"],
    enabled: open,
  });

  const libraryShortcuts = useMemo(() => {
    if (!importConfig?.libraryRoot) return undefined;
    return [{ label: "Library", path: importConfig.libraryRoot }];
  }, [importConfig?.libraryRoot]);

  useEffect(() => {
    if (!open) return;
    setFileBrowserOpen(true);
    sourceSelectedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (open && importConfig?.transferMode && transferMode === "") {
      setTransferMode(importConfig.transferMode);
    }
  }, [importConfig?.transferMode, open, transferMode]);

  const reset = () => {
    setFileBrowserOpen(false);
    setScannedFiles([]);
    setScanTruncated(false);
    setAssignments([]);
    setTransferMode("");
    setStep("scan");
    sourceSelectedRef.current = false;
  };

  const scanMutation = useMutation({
    mutationFn: async (scanPath: string) => {
      const response = await apiRequest("POST", "/api/import/manual/scan", { path: scanPath });
      return (await response.json()) as { files?: ScannedFile[]; truncated?: boolean };
    },
    onSuccess: (data) => {
      const files = data.files ?? [];
      setScannedFiles(files);
      setScanTruncated(data.truncated === true);
      setAssignments(
        files.map((file) => ({
          file,
          gameId: game?.id ?? "",
          gameTitle: game?.title ?? "",
          category: defaultCategory ?? "main",
          platformDir: "",
        }))
      );
      setStep(files.length > 0 ? "assign" : "scan");
      if (files.length === 0) toast({ description: "No supported files found there." });
    },
    onError: (error: Error) =>
      toast({ description: error.message || "Failed to scan path", variant: "destructive" }),
  });

  const makeSelectedFile = (filePath: string): ScannedFile => ({
    name: filePath.split(/[\\/]/).pop() || filePath,
    path: filePath,
    size: 0,
    isDirectory: false,
  });

  const assignSelectedFiles = (files: ScannedFile[]) => {
    setScannedFiles(files);
    setScanTruncated(false);
    setAssignments(
      files.map((file) => ({
        file,
        gameId: game?.id ?? "",
        gameTitle: game?.title ?? "",
        category: defaultCategory ?? "main",
        platformDir: "",
      }))
    );
    setStep(files.length > 0 ? "assign" : "scan");
  };

  const handleFileSelect = (filePath: string) => {
    sourceSelectedRef.current = true;
    setFileBrowserOpen(false);
    assignSelectedFiles([makeSelectedFile(filePath)]);
  };

  const handleMultiFileSelect = (filePaths: string[]) => {
    sourceSelectedRef.current = true;
    setFileBrowserOpen(false);
    assignSelectedFiles(filePaths.map(makeSelectedFile));
  };

  const handleFolderSelect = (selectedPath: string) => {
    sourceSelectedRef.current = true;
    setFileBrowserOpen(false);
    setScanLoading(true);
    scanMutation.mutate(selectedPath, { onSettled: () => setScanLoading(false) });
  };

  const executeMutation = useMutation({
    mutationFn: async () => {
      const selected = assignments.filter((assignment) => assignment.gameId);
      if (selected.length === 0) throw new Error("Assign at least one file to a game");
      if (!transferMode) throw new Error("Choose a transfer mode");

      const results: ManualImportResult[] = [];
      for (const assignment of selected) {
        try {
          await apiRequest("POST", `/api/games/${assignment.gameId}/manual-import`, {
            filePath: assignment.file.path,
            category: assignment.category,
            platformDir: assignment.platformDir || undefined,
            transferMode,
            ...(contentId != null ? { igdbContentId: contentId } : {}),
          });
          results.push({ filePath: assignment.file.path, success: true });
        } catch (error) {
          results.push({
            filePath: assignment.file.path,
            success: false,
            error: error instanceof Error ? error.message : "Import failed",
          });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const succeeded = results.filter((result) => result.success);
      const failed = results.filter((result) => !result.success);
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      for (const assignment of assignments) {
        if (assignment.gameId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/games/${assignment.gameId}/content`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/games/${assignment.gameId}/files`],
          });
        }
      }
      toast({
        title: failed.length > 0 ? "Manual import finished with errors" : "Manual import complete",
        description:
          failed.length > 0
            ? `${succeeded.length} imported, ${failed.length} failed: ${failed
                .slice(0, 2)
                .map((result) => result.error)
                .join(" · ")}`
            : `${succeeded.length} file${succeeded.length === 1 ? "" : "s"} imported.`,
        variant: failed.length > 0 ? "destructive" : "default",
      });
      onOpenChange(false);
      reset();
    },
    onError: (error: Error) =>
      toast({ description: error.message || "Manual import failed", variant: "destructive" }),
  });

  const updateAssignment = (index: number, updates: Partial<Omit<ImportAssignment, "file">>) => {
    setAssignments((current) =>
      current.map((assignment, currentIndex) =>
        currentIndex === index ? { ...assignment, ...updates } : assignment
      )
    );
  };

  const filteredGames = useMemo(() => userGames.filter((item) => !item.hidden), [userGames]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (executeMutation.isPending || scanLoading) return;
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Manual import</DialogTitle>
          <DialogDescription>
            {game
              ? `Select files for ${game.title}, choose their categories, then choose how Questarr should place them.`
              : "Select a folder of files, assign each file to a library game, then choose how Questarr should place them."}
          </DialogDescription>
        </DialogHeader>

        {step === "scan" && (
          <div className="flex min-h-40 items-center justify-center text-muted-foreground">
            {scanLoading || scanMutation.isPending ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Button variant="outline" onClick={() => setFileBrowserOpen(true)}>
                Choose a source folder
              </Button>
            )}
          </div>
        )}

        {step === "assign" && (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b pb-3">
              <Label
                htmlFor="manual-import-transfer-mode"
                className="text-xs text-muted-foreground"
              >
                Transfer mode
              </Label>
              <select
                id="manual-import-transfer-mode"
                value={transferMode}
                onChange={(event) => setTransferMode(event.target.value as ImportTransferMode)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Choose mode…</option>
                {TRANSFER_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {scannedFiles.length} file{scannedFiles.length === 1 ? "" : "s"} found
                {scanTruncated && " (scan limit reached)"}
              </span>
            </div>

            <ScrollArea className="min-h-0 flex-1 rounded-md border">
              <div className="divide-y">
                {assignments.map((assignment, index) => (
                  <div key={assignment.file.path} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={assignment.file.name}>
                          {assignment.file.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {assignment.file.path} · {formatBytes(assignment.file.size)}
                        </p>
                      </div>
                      <select
                        aria-label={`Category for ${assignment.file.name}`}
                        value={assignment.category}
                        disabled={contentId != null}
                        onChange={(event) =>
                          updateAssignment(index, {
                            category: event.target.value as ImportCategory,
                          })
                        }
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {CATEGORY_OPTIONS.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Game</Label>
                        {game ? (
                          <div className="flex h-9 items-center rounded-md border border-input px-3 text-sm">
                            <span className="min-w-0 truncate" title={game.title}>
                              {game.title}
                            </span>
                          </div>
                        ) : (
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              value={assignment.gameTitle}
                              placeholder="Search your games…"
                              className="pl-8"
                              onChange={(event) => {
                                const value = event.target.value;
                                const normalized = value.trim().toLowerCase();
                                const match = normalized
                                  ? filteredGames.find((item) =>
                                      item.title.toLowerCase().includes(normalized)
                                    )
                                  : undefined;
                                updateAssignment(index, {
                                  gameTitle: value,
                                  gameId: match?.id ?? "",
                                });
                              }}
                            />
                          </div>
                        )}
                        {assignment.gameId && (
                          <Badge variant="secondary" className="gap-1">
                            <Check className="h-3 w-3" /> Assigned
                          </Badge>
                        )}
                      </div>

                      {!game && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`manual-platform-${index}`}
                            className="text-xs text-muted-foreground"
                          >
                            Platform folder
                          </Label>
                          <select
                            id={`manual-platform-${index}`}
                            value={assignment.platformDir}
                            onChange={(event) =>
                              updateAssignment(index, { platformDir: event.target.value })
                            }
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Auto-detect from game</option>
                            {platformFolders.map((folder) => (
                              <option key={folder} value={folder}>
                                {folder}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={() => setFileBrowserOpen(true)}>
                Choose another folder
              </Button>
              <Button
                className="gap-2"
                disabled={
                  !transferMode ||
                  !assignments.some((assignment) => assignment.gameId) ||
                  executeMutation.isPending
                }
                onClick={() => executeMutation.mutate()}
              >
                {executeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import assigned files
              </Button>
            </DialogFooter>
          </>
        )}

        <FileBrowser
          open={fileBrowserOpen}
          onOpenChange={(nextOpen) => {
            setFileBrowserOpen(nextOpen);
            if (!nextOpen && !sourceSelectedRef.current && step === "scan") {
              onOpenChange(false);
              reset();
            }
          }}
          root="/"
          {...(libraryShortcuts ? { shortcuts: libraryShortcuts } : {})}
          {...(game
            ? { mode: "file" as const, title: "Select file", onSelect: handleFileSelect }
            : {
                onSelect: handleFolderSelect,
                multiple: true,
                onMultiSelect: handleMultiFileSelect,
                title: "Select files or folder",
              })}
        />
      </DialogContent>
    </Dialog>
  );
}
