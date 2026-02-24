import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Loader2, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

  // State
  const [strategy, setStrategy] = useState<"pc" | "romm">("pc");
  const [destinationPath, setDestinationPath] = useState("");
  const [deleteSource, setDeleteSource] = useState(true);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setStrategy("pc");
      setDestinationPath("");
      setDeleteSource(true);
    }
  }, [open, downloadId]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/imports/${downloadId}/confirm`, {
        strategy,
        proposedPath: destinationPath,
        originalPath: "", // Backend will resolve it
        deleteSource,
      });
    },
    onSuccess: () => {
      toast({
        title: "Import Confirmed",
        description: "The import has been queued for execution.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Import</DialogTitle>
          <DialogDescription>
            Manually configure the import for <strong>{downloadTitle}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Strategy Selection */}
          <div className="space-y-2">
            <Label>Import Strategy</Label>
            <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as "pc" | "romm")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pc" id="pc" />
                <Label htmlFor="pc">Generic / PC (Move to Folder)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="romm" id="romm" />
                <Label htmlFor="romm">RomM (Organize for Rom Manager)</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Destination Path */}
          <div className="space-y-2">
            <Label>Destination Path</Label>
            <div className="flex gap-2">
              <Input
                value={destinationPath}
                onChange={(e) => setDestinationPath(e.target.value)}
                placeholder="/path/to/library"
              />
              <Button variant="outline" size="icon" onClick={() => setIsFileBrowserOpen(true)}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Delete Source */}
          <div className="flex items-center justify-between">
            <Label htmlFor="delete-source">Delete Source Files after Import</Label>
            <Switch id="delete-source" checked={deleteSource} onCheckedChange={setDeleteSource} />
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

      <FileBrowser
        open={isFileBrowserOpen}
        onOpenChange={setIsFileBrowserOpen}
        onSelect={(path) => setDestinationPath(path)}
        title="Select Destination"
      />
    </Dialog>
  );
}
