import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TransferMode = "copy" | "move" | "hardlink";

interface ExternalGame {
  gameId: string;
  title: string;
  libraryPath: string;
  rootFolderId: string;
  rootFolderPath: string;
}

interface TransferPreview {
  gameId: string;
  title: string;
  sourcePath: string;
  destinationPath: string;
  sizeBytes: number;
  freeBytes: number | null;
  needsSpace: boolean;
  crossFilesystem: boolean;
  destinationExists: boolean;
  defaultMode: TransferMode;
}

const MODE_LABELS: Record<TransferMode, { label: string; hint: string }> = {
  copy: { label: "Copy", hint: "Keeps the original files where they are. Safest option." },
  move: {
    label: "Move",
    hint: "Removes the original files once the copy is verified. Across disks this is copy, verify, then delete.",
  },
  hardlink: {
    label: "Hardlink",
    hint: "No extra space on the same disk. Falls back to a copy across disks.",
  },
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Games discovered in a root folder, each with an "Import into library" action
 * that copies or moves their files into the library root.
 */
export function ExternalGamesImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ExternalGame | null>(null);
  const [mode, setMode] = useState<TransferMode>("copy");

  const { data: games = [] } = useQuery<ExternalGame[]>({
    queryKey: ["/api/library/external-games"],
  });

  const {
    data: preview,
    error: previewError,
    isLoading: previewLoading,
  } = useQuery<TransferPreview, Error>({
    queryKey: ["/api/library/external-games", selected?.gameId, "preview"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/library/external-games/${selected!.gameId}/preview`
      );
      return (await res.json()) as TransferPreview;
    },
    enabled: !!selected,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const importMutation = useMutation({
    mutationFn: async (vars: { gameId: string; mode: TransferMode }) => {
      await apiRequest("POST", `/api/library/external-games/${vars.gameId}/import`, {
        mode: vars.mode,
      });
    },
    onSuccess: () => {
      toast({ title: "Game Imported", description: "Its files are now in your library." });
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/library/external-games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import-tasks"] });
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const blocked = useMemo(
    () => !preview || preview.destinationExists || preview.needsSpace,
    [preview]
  );

  if (games.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Import into Library ({games.length})
      </p>
      <p className="text-xs text-muted-foreground">
        These games live in a root folder. Copy or move them into your library root to name and
        organize them like downloaded games.
      </p>
      {games.map((game) => (
        <div
          key={game.gameId}
          className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{game.title}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{game.libraryPath}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0 gap-2 sm:min-h-9"
            aria-label={`Import ${game.title} into the library`}
            onClick={() => {
              setMode("copy");
              setSelected(game);
            }}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            Import into library
          </Button>
        </div>
      ))}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import {selected?.title} into the library</DialogTitle>
            <DialogDescription>
              The destination is decided by your Import settings (library root and naming pattern).
            </DialogDescription>
          </DialogHeader>

          {previewLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          {previewError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{previewError.message}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-4">
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">From</dt>
                  <dd className="break-all font-mono">{preview.sourcePath}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">To</dt>
                  <dd className="break-all font-mono">{preview.destinationPath}</dd>
                </div>
                <div className="flex gap-6">
                  <div>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>{formatBytes(preview.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Free in library</dt>
                    <dd>{formatBytes(preview.freeBytes)}</dd>
                  </div>
                </div>
              </dl>

              {preview.destinationExists && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    A folder with this name already exists in the library. Nothing is overwritten.
                  </AlertDescription>
                </Alert>
              )}
              {preview.needsSpace && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Not enough free space in the library root.</AlertDescription>
                </Alert>
              )}

              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as TransferMode)}
                aria-label="Transfer mode"
                className="gap-3"
              >
                {(Object.keys(MODE_LABELS) as TransferMode[]).map((m) => (
                  <div key={m} className="flex items-start gap-3">
                    <RadioGroupItem value={m} id={`transfer-mode-${m}`} className="mt-1" />
                    <Label htmlFor={`transfer-mode-${m}`} className="space-y-0.5 font-normal">
                      <span className="block text-sm font-medium">{MODE_LABELS[m].label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {MODE_LABELS[m].hint}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {mode === "move" && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    The original files in the root folder will be deleted after the move.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              disabled={blocked || importMutation.isPending}
              onClick={() => selected && importMutation.mutate({ gameId: selected.gameId, mode })}
            >
              {importMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "move" ? "Move into library" : "Import into library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
