import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, FolderOpen, Loader2, Info, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Downloader, PathMapping } from "@shared/schema";
import { FileBrowser } from "./FileBrowser";

const ANY_DOWNLOADER_VALUE = "__any__";
const UNAVAILABLE_DOWNLOADER_VALUE = "__unavailable__";

interface PathMappingFormState {
  remotePath: string;
  localPath: string;
  remoteHost: string | null;
}

function extractDownloaderHost(url: string): string | null {
  try {
    const normalizedUrl =
      url.startsWith("http://") || url.startsWith("https://") ? url : `http://${url}`;
    return new URL(normalizedUrl).hostname;
  } catch {
    return null;
  }
}

function getInitialFormState(mapping?: PathMapping | null): PathMappingFormState {
  return {
    remotePath: mapping?.remotePath ?? "",
    localPath: mapping?.localPath ?? "",
    remoteHost: mapping?.remoteHost ?? null,
  };
}

export function PathMappingSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PathMappingFormState>(getInitialFormState());

  const { data: mappings, isLoading } = useQuery<PathMapping[]>({
    queryKey: ["/api/imports/mappings/paths"],
  });

  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders"],
  });

  const downloaderOptions = useMemo(() => {
    const hostToNames = new Map<string, string[]>();

    for (const downloader of downloaders) {
      const host = extractDownloaderHost(downloader.url);
      if (!host) continue;

      const existingNames = hostToNames.get(host) ?? [];
      existingNames.push(downloader.name);
      hostToNames.set(host, existingNames);
    }

    return Array.from(hostToNames.entries())
      .map(([host, names]) => ({
        host,
        label: Array.from(new Set(names))
          .sort((a, b) => a.localeCompare(b))
          .join(", "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [downloaders]);

  const downloaderLabelByHost = useMemo(
    () => new Map(downloaderOptions.map((option) => [option.host, option.label])),
    [downloaderOptions]
  );

  const openCreateDialog = () => {
    setEditingMappingId(null);
    setFormState(getInitialFormState());
    setIsDialogOpen(true);
  };

  const openEditDialog = (mapping: PathMapping) => {
    setEditingMappingId(mapping.id);
    setFormState(getInitialFormState(mapping));
    setIsDialogOpen(true);
  };

  const closeDialog = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingMappingId(null);
      setFormState(getInitialFormState());
    }
  };

  const addMutation = useMutation({
    mutationFn: async (mapping: PathMappingFormState) => {
      await apiRequest("POST", "/api/imports/mappings/paths", mapping);
    },
    onSuccess: () => {
      toast({ title: "Mapping Added", description: "New path mapping has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/paths"] });
      closeDialog(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, mapping }: { id: string; mapping: PathMappingFormState }) => {
      await apiRequest("PATCH", `/api/imports/mappings/paths/${id}`, mapping);
    },
    onSuccess: () => {
      toast({ title: "Mapping Updated", description: "Path mapping has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/paths"] });
      closeDialog(false);
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/imports/mappings/paths/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Mapping Deleted", description: "Path mapping has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/paths"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete path mapping.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!formState.remotePath || !formState.localPath) {
      toast({
        title: "Validation Error",
        description: "Both paths are required.",
        variant: "destructive",
      });
      return;
    }

    if (editingMappingId) {
      updateMutation.mutate({ id: editingMappingId, mapping: formState });
      return;
    }

    addMutation.mutate(formState);
  };

  const isSaving = addMutation.isPending || updateMutation.isPending;
  const selectedDownloaderValue =
    formState.remoteHost === null
      ? ANY_DOWNLOADER_VALUE
      : downloaderLabelByHost.has(formState.remoteHost)
        ? formState.remoteHost
        : UNAVAILABLE_DOWNLOADER_VALUE;

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Path Mappings</CardTitle>
            <CardDescription>
              Translate download client paths to paths accessible by Questarr. Required when
              Questarr and your download client run on separate machines or containers with
              different volume mounts.
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={closeDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" /> Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingMappingId ? "Edit Path Mapping" : "Add Path Mapping"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Downloader (Optional)</Label>
                  <Select
                    value={selectedDownloaderValue}
                    onValueChange={(value) =>
                      setFormState({
                        ...formState,
                        remoteHost:
                          value === ANY_DOWNLOADER_VALUE || value === UNAVAILABLE_DOWNLOADER_VALUE
                            ? null
                            : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any downloader" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_DOWNLOADER_VALUE}>Any downloader</SelectItem>
                      {selectedDownloaderValue === UNAVAILABLE_DOWNLOADER_VALUE && (
                        <SelectItem value={UNAVAILABLE_DOWNLOADER_VALUE} disabled>
                          No matching downloader
                        </SelectItem>
                      )}
                      {downloaderOptions.map((option) => (
                        <SelectItem key={option.host} value={option.host}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Limit this mapping to a configured downloader, or leave it generic.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Remote Path</Label>
                  <Input
                    placeholder="/home/user/downloads"
                    value={formState.remotePath}
                    onChange={(e) => setFormState({ ...formState, remotePath: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Local Path</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="/mnt/media/downloads"
                      value={formState.localPath}
                      onChange={(e) => setFormState({ ...formState, localPath: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Browse local path"
                      onClick={() => setIsFileBrowserOpen(true)}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button className="w-full" onClick={handleSubmit} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingMappingId ? "Save Changes" : "Create Mapping"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-3 text-sm">
            <p>
              <strong>When do I need this?</strong> When your download client and Questarr are on
              different machines or Docker containers with different volume mounts. For example, if
              qBittorrent reports a completed file as{" "}
              <code className="rounded bg-muted px-1">/downloads/game.zip</code> but Questarr
              accesses that share at{" "}
              <code className="rounded bg-muted px-1">/mnt/nas/downloads/game.zip</code>, add a
              mapping from <code className="rounded bg-muted px-1">/downloads</code> to{" "}
              <code className="rounded bg-muted px-1">/mnt/nas/downloads</code>.
            </p>
            <p>
              <strong>When can I skip it?</strong> If Questarr and your download client run on the
              same machine and use identical paths, no mapping is needed - paths pass through
              unchanged.
            </p>
            <p>
              <strong>How it works:</strong> The remote path prefix is replaced with the local path.
              If multiple mappings match, the most specific (longest) prefix wins. Downloader-scoped
              mappings only apply to the selected configured downloader.
            </p>
          </AlertDescription>
        </Alert>
        <FileBrowser
          open={isFileBrowserOpen}
          onOpenChange={setIsFileBrowserOpen}
          onSelect={(path) => setFormState({ ...formState, localPath: path })}
          initialPath={formState.localPath || "/"}
          root="/"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Downloader</TableHead>
              <TableHead>Remote Path</TableHead>
              <TableHead>Local Path</TableHead>
              <TableHead className="w-[90px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No mappings defined
                </TableCell>
              </TableRow>
            )}
            {mappings?.map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell>
                  {mapping.remoteHost ? (
                    (downloaderLabelByHost.get(mapping.remoteHost) ?? (
                      <span className="text-muted-foreground italic">No matching downloader</span>
                    ))
                  ) : (
                    <span className="text-muted-foreground italic">Any downloader</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{mapping.remotePath}</TableCell>
                <TableCell className="font-mono text-xs">{mapping.localPath}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit mapping for ${mapping.remotePath}`}
                      onClick={() => openEditDialog(mapping)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete mapping for ${mapping.remotePath}`}
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(mapping.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
