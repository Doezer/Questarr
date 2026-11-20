import { useState, useEffect, useRef } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import type { ImportConfig } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FolderOpen, Package, File } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { FileBrowser } from "./FileBrowser";
import ImportProgressPanel, { type ImportOperation } from "./ImportProgressPanel";

interface ImportReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  downloadId: string;
  downloadTitle: string;
  /** True when this download's last extraction attempt failed because the archive is
   * password-protected — shows a required password field and pre-enables Unpack Archive
   * instead of the normal path-review form. */
  passwordRequired?: boolean;
}

export default function ImportReviewModal({
  open,
  onOpenChange,
  downloadId,
  downloadTitle,
  passwordRequired = false,
}: Readonly<ImportReviewModalProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: importConfig } = useQuery<ImportConfig>({
    queryKey: ["/api/imports/config"],
  });

  // State
  const [strategy] = useState<"pc">("pc");
  const [sourcePath, setSourcePath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [transferMode, setTransferMode] = useState<"move" | "copy" | "hardlink" | "symlink">(
    "move"
  );
  const [unpackArchiveOverride, setUnpackArchiveOverride] = useState<boolean>();
  const [password, setPassword] = useState("");
  const [isSourceBrowserOpen, setIsSourceBrowserOpen] = useState(false);
  const [isDestBrowserOpen, setIsDestBrowserOpen] = useState(false);

  const planApplied = useRef(false);

  // The confirm call returns at once with an operation id; hashing, scanning, extraction
  // and transfer run server-side and are polled here. A reload restores a running one.
  const [operationId, setOperationId] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const mustHavePassword = passwordRequired || needsPassword;
  const unpackArchive =
    mustHavePassword || (unpackArchiveOverride ?? importConfig?.autoUnpack ?? false);
  const handledFinish = useRef<string | null>(null);

  // Declared before the restore effect below so a fresh open starts clean, then adopts.
  useEffect(() => {
    setOperationId(null);
    setNeedsPassword(false);
    handledFinish.current = null;
  }, [open, downloadId]);

  const { data: restoredOperation, isLoading: isRestoring } = useQuery<ImportOperation | null>({
    queryKey: [`/api/imports/${downloadId}/operation`],
    enabled: open && !operationId,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (
      open &&
      !operationId &&
      restoredOperation &&
      restoredOperation.status !== "completed" &&
      handledFinish.current !== restoredOperation.id
    ) {
      setOperationId(restoredOperation.id);
    }
  }, [open, operationId, restoredOperation]);

  // Keep polling through transient failures; only a terminal result or a 404 (the server
  // forgot the operation, e.g. after a restart) stops it.
  const { data: operation, error: operationError } = useQuery<ImportOperation>({
    queryKey: [`/api/imports/operations/${operationId}`],
    enabled: open && !!operationId,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.status !== "running") return false;
      const err = query.state.error;
      if (err instanceof ApiError && err.status === 404) return false;
      return 1500;
    },
  });
  const operationLost = operationError instanceof ApiError && operationError.status === 404;

  const planUrl = sourcePath
    ? `/api/imports/${downloadId}/plan?sourcePath=${encodeURIComponent(sourcePath)}`
    : `/api/imports/${downloadId}/plan`;

  const { data: planData } = useQuery<{
    originalPath: string;
    proposedPath: string;
    files: Array<{ name: string; isArchive: boolean }>;
    hasArchive: boolean;
    totalCount: number;
  }>({
    queryKey: [planUrl],
    enabled: open,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // Reset state on open, defaulting transfer mode to the user's configured setting
  useEffect(() => {
    if (open) {
      planApplied.current = false;
      setSourcePath("");
      setDestinationPath(importConfig?.libraryRoot ?? "");
      setTransferMode(importConfig?.transferMode ?? "move");
      setPassword("");
    }
  }, [open, downloadId, importConfig?.libraryRoot, importConfig?.transferMode, passwordRequired]);

  useEffect(() => {
    if (open) setUnpackArchiveOverride(undefined);
  }, [open, downloadId]);

  // Pre-fill paths from plan once when it loads
  useEffect(() => {
    if (open && planData && !planApplied.current) {
      planApplied.current = true;
      if (planData.originalPath) setSourcePath(planData.originalPath);
      if (planData.proposedPath) setDestinationPath(planData.proposedPath);
    }
  }, [open, planData]);

  const skipMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/imports/${downloadId}`);
    },
    onSuccess: () => {
      toast({ description: "Import skipped" });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to skip import", description: error.message, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/imports/${downloadId}/confirm`, {
        strategy,
        proposedPath: destinationPath,
        ...(sourcePath ? { originalPath: sourcePath } : {}),
        transferMode,
        unpack: unpackArchive,
        ...(unpackArchive && password ? { password } : {}),
      });
      const body = (await res.json()) as { operationId: string };
      return body.operationId;
    },
    onSuccess: (id: string) => {
      setOperationId(id);
    },
    onError: (error: Error) => {
      // Another request already started this import: follow that one instead of failing.
      const conflictId =
        error instanceof ApiError && error.status === 409
          ? (error.data as { operationId?: unknown } | undefined)?.operationId
          : undefined;
      if (typeof conflictId === "string") {
        setOperationId(conflictId);
        return;
      }
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  // React once to a finished operation: close on success, otherwise stay on the failure
  // so the user can read it and go back to adjust (password / confirm again).
  useEffect(() => {
    if (!operation || operation.status === "running" || handledFinish.current === operation.id) {
      return;
    }
    handledFinish.current = operation.id;
    queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    if (operation.status === "completed") {
      toast({ title: "Import Complete", description: `${downloadTitle} was imported.` });
      onOpenChange(false);
    } else if (operation.passwordRequired) {
      setNeedsPassword(true);
    }
  }, [operation, queryClient, toast, downloadTitle, onOpenChange]);

  const showProgress = !!operationId && !confirmMutation.isPending;
  const actionsLocked = confirmMutation.isPending || skipMutation.isPending || isRestoring;

  const handleConfirm = () => {
    if (!destinationPath) {
      toast({
        title: "Validation Error",
        description: "Destination path is required.",
        variant: "destructive",
      });
      return;
    }
    if (mustHavePassword && !password) {
      toast({
        title: "Validation Error",
        description: "This archive is password-protected — enter a password to extract it.",
        variant: "destructive",
      });
      return;
    }
    const libraryRoot = importConfig?.libraryRoot ?? "";
    if (libraryRoot && destinationPath === libraryRoot) {
      toast({
        title: "Validation Error",
        description: `Destination must be a subfolder inside ${libraryRoot}, not the root itself.`,
        variant: "destructive",
      });
      return;
    }
    confirmMutation.mutate();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mustHavePassword ? "Password Required" : "Review Import"}</DialogTitle>
            <DialogDescription>
              {mustHavePassword ? (
                <>
                  <strong>{downloadTitle}</strong> is a password-protected archive. Enter the
                  password to extract and import it.
                </>
              ) : (
                <>
                  Manually configure the import for <strong>{downloadTitle}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {showProgress ? (
            <div className="py-4">
              {operation ? (
                <ImportProgressPanel operation={operation} />
              ) : operationLost ? (
                <div role="alert" className="rounded-md border border-amber-500/50 p-3 text-sm">
                  This import is no longer tracked (the server may have restarted). Check the
                  library or the pending imports list before trying again.
                </div>
              ) : (
                <div
                  role="status"
                  className="flex items-center gap-3 rounded-md border p-3 text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading import progress…
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Source Path */}
              <div className="space-y-2">
                <Label htmlFor="import-review-source-path">
                  Source Path{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    (optional — auto-resolved from download client)
                  </span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="import-review-source-path"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="Auto-resolved from download client"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Browse source directories"
                    onClick={() => setIsSourceBrowserOpen(true)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Destination Path */}
              <div className="space-y-2">
                <Label htmlFor="import-review-destination-path">Destination Path</Label>
                <div className="flex gap-2">
                  <Input
                    id="import-review-destination-path"
                    value={destinationPath}
                    onChange={(e) => setDestinationPath(e.target.value)}
                    placeholder="/path/to/library"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Browse destination directories"
                    onClick={() => setIsDestBrowserOpen(true)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {planData?.files && planData.files.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Download Contents</Label>
                  <ScrollArea className="h-32 rounded-md border p-2">
                    <div className="space-y-0.5">
                      {planData.files.map((f) => (
                        <div key={f.name} className="flex items-center gap-1.5 text-xs">
                          {f.isArchive ? (
                            <Package className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                          ) : (
                            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span
                            className={f.isArchive ? "text-amber-400" : "text-muted-foreground"}
                          >
                            {f.name}
                          </span>
                        </div>
                      ))}
                      {planData.totalCount > planData.files.length && (
                        <p className="text-xs text-muted-foreground pt-0.5">
                          …and {planData.totalCount - planData.files.length} more file
                          {planData.totalCount - planData.files.length === 1 ? "" : "s"} not shown
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                  {planData.hasArchive && (
                    <p className="text-xs text-amber-400/80">
                      Archive files detected — consider enabling Unpack Archive below.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Transfer Mode</Label>
                <Select
                  value={transferMode}
                  onValueChange={(value) =>
                    setTransferMode(value as "move" | "copy" | "hardlink" | "symlink")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="move">Move</SelectItem>
                    <SelectItem value="copy">Copy</SelectItem>
                    <SelectItem value="hardlink">Hardlink</SelectItem>
                    <SelectItem value="symlink">Symlink</SelectItem>
                  </SelectContent>
                </Select>
                {transferMode === "hardlink" && (
                  <p className="text-xs text-muted-foreground">
                    Uses a hardlink when both folders are on the same volume and falls back to a
                    copy otherwise. The imported file survives later source removal.
                  </p>
                )}
                {transferMode === "symlink" && (
                  <p className="text-xs text-muted-foreground">
                    Works across different volumes, but the link breaks if the source file is later
                    removed or moved.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Unpack Archive</Label>
                  <p className="text-xs text-muted-foreground">
                    Extract .zip, .rar, .7z before placing files.
                  </p>
                </div>
                <Switch
                  checked={unpackArchive}
                  onCheckedChange={setUnpackArchiveOverride}
                  disabled={mustHavePassword}
                />
              </div>

              {unpackArchive && (
                <div className="space-y-2">
                  <Label htmlFor="import-review-password">
                    Archive Password{mustHavePassword ? "" : " (optional)"}
                  </Label>
                  <Input
                    id="import-review-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          )}

          {showProgress ? (
            <DialogFooter>
              {(operation?.status === "failed" || operationLost) && (
                <Button onClick={() => setOperationId(null)}>Back to review</Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {!operationLost && (!operation || operation.status === "running")
                  ? "Close (keeps running)"
                  : "Close"}
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => skipMutation.mutate()}
                disabled={actionsLocked}
              >
                {skipMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Skip Import
              </Button>
              <Button onClick={handleConfirm} disabled={actionsLocked}>
                {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Import
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <FileBrowser
        open={isSourceBrowserOpen}
        onOpenChange={setIsSourceBrowserOpen}
        onSelect={(path) => setSourcePath(path)}
        initialPath={sourcePath || "/"}
        title="Select Source"
        root="/"
      />
      <FileBrowser
        open={isDestBrowserOpen}
        onOpenChange={setIsDestBrowserOpen}
        onSelect={(path) => setDestinationPath(path)}
        initialPath={destinationPath || importConfig?.libraryRoot || "/"}
        title="Select Destination"
        root="/"
      />
    </>
  );
}
