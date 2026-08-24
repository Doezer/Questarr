import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Plus,
  Trash2,
  FolderOpen,
  Loader2,
  Info,
  RefreshCw,
  Search,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RootFolder } from "@shared/schema";
import { FileBrowser } from "./FileBrowser";

interface ScanProgress {
  rootFolderId: string;
  rootFolderPath: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed";
  totalCandidates: number;
  processedCandidates: number;
  matched: number;
  unmatched: number;
  errors: number;
  currentCandidate?: string;
  errorMessage?: string;
}

interface UnmatchedEntry {
  rootFolderId: string;
  rootFolderPath: string;
  folderName: string;
  absolutePath: string;
  candidates: Array<{ igdbId: number; name: string; releaseYear: number | null }>;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function RootFolderDiscovery() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");

  const { data: rootFolders = [], isLoading } = useQuery<RootFolder[]>({
    queryKey: ["/api/root-folders"],
  });

  const anyScanning = (progress?: ScanProgress[]) =>
    (progress ?? []).some((p) => p.status === "running");

  const { data: scanProgress = [] } = useQuery<ScanProgress[]>({
    queryKey: ["/api/library/scan/status"],
    refetchInterval: (query) => (anyScanning(query.state.data) ? 1500 : false),
  });

  const { data: unmatched = [] } = useQuery<UnmatchedEntry[]>({
    queryKey: ["/api/library/scan/unmatched"],
    refetchInterval: anyScanning(scanProgress) ? 1500 : false,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/library/scan/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/library/scan/unmatched"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/root-folders", {
        path: newPath,
        name: newName.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Root Folder Added" });
      setIsDialogOpen(false);
      setNewPath("");
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could Not Add Folder", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/root-folders/${id}`, { enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] }),
  });

  const allowDeleteMutation = useMutation({
    mutationFn: async ({ id, allowDelete }: { id: string; allowDelete: boolean }) => {
      await apiRequest("PATCH", `/api/root-folders/${id}`, { allowDelete });
    },
    onSuccess: (_data, { allowDelete }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] });
      if (allowDelete) {
        toast({
          title: "Deletion Allowed",
          description:
            "Questarr can now delete files in this folder when you remove a game with its files.",
        });
      }
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/root-folders/${id}/health-check`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/root-folders/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Root Folder Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/root-folders"] });
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (rootFolderId?: string) => {
      await apiRequest("POST", "/api/library/scan", rootFolderId ? { rootFolderId } : {});
    },
    onSuccess: () => {
      toast({ title: "Scan Started", description: "This can take a while for large folders." });
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({ title: "Scan Failed to Start", description: error.message, variant: "destructive" });
    },
  });

  const matchMutation = useMutation({
    mutationFn: async (vars: { rootFolderId: string; folderName: string; igdbId: number }) => {
      await apiRequest("POST", "/api/library/scan/unmatched/match", vars);
    },
    onSuccess: () => {
      toast({ title: "Game Matched", description: "Added to your library." });
      queryClient.invalidateQueries({ queryKey: ["/api/library/scan/unmatched"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: (error: Error) => {
      toast({ title: "Match Failed", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Discover Existing Games</CardTitle>
            <CardDescription>
              Scan extra folders on disk for games you already own but haven&apos;t imported yet —
              separate from the Library Root above.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={rootFolders.length === 0 || scanMutation.isPending}
              onClick={() => scanMutation.mutate(undefined)}
            >
              <Search className="h-4 w-4" />
              Scan All
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> Add Folder
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Root Folder</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="root-folder-path">Path</Label>
                    <div className="flex gap-2">
                      <Input
                        id="root-folder-path"
                        placeholder="/mnt/old-library"
                        value={newPath}
                        onChange={(e) => setNewPath(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Browse for folder"
                        onClick={() => setIsFileBrowserOpen(true)}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="root-folder-name">Label (optional)</Label>
                    <Input
                      id="root-folder-name"
                      placeholder="Old NAS library"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => addMutation.mutate()}
                    disabled={!newPath.trim() || addMutation.isPending}
                  >
                    {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Add Root Folder
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Games found here are added as <strong>owned</strong> and linked to their folder on disk,
            but that folder stays outside your library root — it is never moved, renamed, or deleted
            by Questarr unless you turn on <strong>Allow Delete</strong> for that folder below. With
            it off (the default), removing a game with its files skips anything discovered here.
          </AlertDescription>
        </Alert>

        <FileBrowser
          open={isFileBrowserOpen}
          onOpenChange={setIsFileBrowserOpen}
          onSelect={(path) => {
            setNewPath(path);
            setIsFileBrowserOpen(false);
          }}
          initialPath={newPath || "/"}
          root="/"
          title="Select Root Folder"
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Path</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Free Space</TableHead>
              <TableHead className="w-[80px]">Enabled</TableHead>
              <TableHead className="w-[110px]">Allow Delete</TableHead>
              <TableHead className="w-[140px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rootFolders.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No root folders configured yet
                </TableCell>
              </TableRow>
            )}
            {rootFolders.map((folder) => {
              const progress = scanProgress.find((p) => p.rootFolderId === folder.id);
              return (
                <TableRow key={folder.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{folder.path}</div>
                    {folder.name && (
                      <div className="text-xs text-muted-foreground">{folder.name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {folder.accessible === false ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Inaccessible
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Accessible</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3.5 w-3.5" />
                      {formatBytes(folder.diskFreeBytes)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={folder.enabled}
                      onCheckedChange={(enabled) =>
                        toggleMutation.mutate({ id: folder.id, enabled })
                      }
                      aria-label={`Enable ${folder.path}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={folder.allowDelete}
                      onCheckedChange={(allowDelete) =>
                        allowDeleteMutation.mutate({ id: folder.id, allowDelete })
                      }
                      aria-label={`Allow deleting files in ${folder.path}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Scan ${folder.path}`}
                        disabled={!folder.enabled || progress?.status === "running"}
                        onClick={() => scanMutation.mutate(folder.id)}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Recheck health of ${folder.path}`}
                        disabled={healthCheckMutation.isPending}
                        onClick={() => healthCheckMutation.mutate(folder.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${folder.path}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(folder.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {scanProgress.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scan Progress
            </p>
            {scanProgress.map((p) => (
              <div key={p.rootFolderId} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono">{p.rootFolderPath}</span>
                  <Badge
                    variant={
                      p.status === "failed"
                        ? "destructive"
                        : p.status === "completed"
                          ? "secondary"
                          : "default"
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
                {p.totalCandidates > 0 && (
                  <Progress value={(p.processedCandidates / p.totalCandidates) * 100} />
                )}
                <p className="text-xs text-muted-foreground">
                  {p.processedCandidates}/{p.totalCandidates} scanned · {p.matched} matched ·{" "}
                  {p.unmatched} need review · {p.errors} errors
                  {p.currentCandidate && p.status === "running" && (
                    <> · currently: {p.currentCandidate}</>
                  )}
                </p>
                {p.errorMessage && <p className="text-xs text-destructive">{p.errorMessage}</p>}
              </div>
            ))}
          </div>
        )}

        {unmatched.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Needs Review ({unmatched.length})
            </p>
            {unmatched.map((entry) => (
              <div
                key={`${entry.rootFolderId}:${entry.folderName}`}
                className="rounded-md border p-3 space-y-2"
              >
                <p className="text-sm font-medium">{entry.folderName}</p>
                <p className="text-xs text-muted-foreground font-mono">{entry.absolutePath}</p>
                {entry.candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No IGDB matches found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {entry.candidates.map((c) => (
                      <Button
                        key={c.igdbId}
                        variant="outline"
                        size="sm"
                        disabled={matchMutation.isPending}
                        onClick={() =>
                          matchMutation.mutate({
                            rootFolderId: entry.rootFolderId,
                            folderName: entry.folderName,
                            igdbId: c.igdbId,
                          })
                        }
                      >
                        {c.name}
                        {c.releaseYear ? ` (${c.releaseYear})` : ""}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
