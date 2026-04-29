import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Loader2, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { FileBrowser } from "./FileBrowser";

interface ImportReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  downloadId: string;
  downloadTitle: string;
}

export default function ImportReviewModal({
  open,
  onOpenChange,
  downloadId,
  downloadTitle,
}: ImportReviewModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: importConfig } = useQuery<ImportConfig>({
    queryKey: ["/api/imports/config"],
  });

  // State
  const [strategy] = useState<"pc">("pc");
  const [destinationPath, setDestinationPath] = useState("");
  const [transferMode, setTransferMode] = useState<"move" | "copy" | "hardlink" | "symlink">(
    "move"
  );
  const [unpackArchive, setUnpackArchive] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);

  // Reset state on open, defaulting transfer mode to the user's configured setting
  useEffect(() => {
    if (open) {
      setDestinationPath(importConfig?.libraryRoot ?? "");
      setTransferMode((importConfig?.transferMode as typeof transferMode) ?? "move");
      setUnpackArchive(false);
    }
  }, [open, downloadId, importConfig?.libraryRoot, importConfig?.transferMode]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/imports/${downloadId}/confirm`, {
        strategy,
        proposedPath: destinationPath,
        originalPath: "", // Backend will resolve it
        transferMode,
        unpack: unpackArchive,
      });
    },
    onSuccess: () => {
      toast({
        title: "Import Confirmed",
        description: "The import has been queued for execution.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleConfirm = () => {
    if (!destinationPath) {
      toast({
        title: "Validation Error",
        description: "Destination path is required.",
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
            <DialogTitle>Review Import</DialogTitle>
            <DialogDescription>
              Manually configure the import for <strong>{downloadTitle}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
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
                  onClick={() => setIsFileBrowserOpen(true)}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

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
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Unpack Archive</Label>
                <p className="text-xs text-muted-foreground">
                  Extract .zip, .rar, .7z before placing files.
                </p>
              </div>
              <Switch checked={unpackArchive} onCheckedChange={setUnpackArchive} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FileBrowser
        open={isFileBrowserOpen}
        onOpenChange={setIsFileBrowserOpen}
        onSelect={(path) => setDestinationPath(path)}
        initialPath={destinationPath || importConfig?.libraryRoot || "/"}
        title="Select Destination"
        root="/"
      />
    </>
  );
}
