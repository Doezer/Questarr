import { useState } from "react";
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
import { Plus, Trash2, FolderOpen, Loader2, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PathMapping } from "@shared/schema";
import { FileBrowser } from "./FileBrowser";

export function PathMappingSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({ remotePath: "", localPath: "", remoteHost: "" });

  const { data: mappings, isLoading } = useQuery<PathMapping[]>({
    queryKey: ["/api/imports/mappings/paths"],
  });

  const addMutation = useMutation({
    mutationFn: async (mapping: { remotePath: string; localPath: string; remoteHost?: string }) => {
      await apiRequest("POST", "/api/imports/mappings/paths", mapping);
    },
    onSuccess: () => {
      toast({ title: "Mapping Added", description: "New path mapping has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/paths"] });
      setIsAddDialogOpen(false);
      setNewMapping({ remotePath: "", localPath: "", remoteHost: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  const handleCreate = () => {
    if (!newMapping.remotePath || !newMapping.localPath) {
      toast({
        title: "Validation Error",
        description: "Both paths are required.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate({
      remotePath: newMapping.remotePath,
      localPath: newMapping.localPath,
      remoteHost: newMapping.remoteHost || undefined,
    });
  };

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
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Path Mapping</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Remote Host (Optional)</Label>
                  <Input
                    placeholder="e.g. seedbox.io (leave empty for generic)"
                    value={newMapping.remoteHost}
                    onChange={(e) => setNewMapping({ ...newMapping, remoteHost: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only apply this mapping for this specific downloader hostname.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Remote Path</Label>
                  <Input
                    placeholder="/home/user/downloads"
                    value={newMapping.remotePath}
                    onChange={(e) => setNewMapping({ ...newMapping, remotePath: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Local Path</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="/mnt/media/downloads"
                      value={newMapping.localPath}
                      onChange={(e) => setNewMapping({ ...newMapping, localPath: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsFileBrowserOpen(true)}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={addMutation.isPending}>
                  {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Mapping
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
              mapping from <code className="rounded bg-muted px-1">/downloads</code> →{" "}
              <code className="rounded bg-muted px-1">/mnt/nas/downloads</code>.
            </p>
            <p>
              <strong>When can I skip it?</strong> If Questarr and your download client run on the
              same machine and use identical paths, no mapping is needed — paths pass through
              unchanged.
            </p>
            <p>
              <strong>How it works:</strong> The remote path prefix is replaced with the local path.
              If multiple mappings match, the most specific (longest) prefix wins. Use the{" "}
              <em>Remote Host</em> field to scope a mapping to one specific downloader — useful when
              you have multiple clients on different machines.
            </p>
          </AlertDescription>
        </Alert>
        <FileBrowser
          open={isFileBrowserOpen}
          onOpenChange={setIsFileBrowserOpen}
          onSelect={(path) => setNewMapping({ ...newMapping, localPath: path })}
          root="/"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Remote Host</TableHead>
              <TableHead>Remote Path</TableHead>
              <TableHead>Local Path</TableHead>
              <TableHead className="w-[50px]"></TableHead>
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
                  {mapping.remoteHost || <span className="text-muted-foreground italic">Any</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{mapping.remotePath}</TableCell>
                <TableCell className="font-mono text-xs">{mapping.localPath}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(mapping.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
