import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { asZodType } from "@/lib/utils";
import { Plus, Edit, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDownloaderSchema, type Downloader, type InsertDownloader } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const downloaderTypes = [
  { value: "transmission", label: "Transmission" },
  { value: "rtorrent", label: "rTorrent" },
  { value: "utorrent", label: "uTorrent" },
  { value: "vuze", label: "Vuze" },
  { value: "qbittorrent", label: "qBittorrent" },
] as const;

export default function DownloadersPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDownloader, setEditingDownloader] = useState<Downloader | null>(null);

  const { data: downloaders = [], isLoading } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: InsertDownloader) => {
      const response = await fetch("/api/downloaders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to add downloader");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloaders"] });
      setIsDialogOpen(false);
      setEditingDownloader(null);
      toast({ title: "Downloader added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add downloader", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertDownloader> }) => {
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update downloader");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloaders"] });
      setIsDialogOpen(false);
      setEditingDownloader(null);
      toast({ title: "Downloader updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update downloader", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete downloader");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloaders"] });
      toast({ title: "Downloader deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete downloader", variant: "destructive" });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle downloader");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloaders"] });
    },
  });

  const form = useForm<InsertDownloader>({
    resolver: zodResolver(asZodType<InsertDownloader>(insertDownloaderSchema)),
    defaultValues: {
      name: "",
      type: "transmission",
      url: "",
      username: "",
      password: "",
      enabled: true,
      priority: 1,
      downloadPath: "",
      category: "games",
      settings: "",
    },
  });

  const onSubmit = (data: InsertDownloader) => {
    if (editingDownloader) {
      updateMutation.mutate({ id: editingDownloader.id, data });
    } else {
      addMutation.mutate(data);
    }
  };

  const handleEdit = (downloader: Downloader) => {
    setEditingDownloader(downloader);
    form.reset({
      name: downloader.name,
      type: downloader.type,
      url: downloader.url,
      username: downloader.username ?? "",
      password: downloader.password ?? "",
      enabled: downloader.enabled,
      priority: downloader.priority,
      downloadPath: downloader.downloadPath ?? "",
      category: downloader.category ?? "games",
      settings: downloader.settings ?? "",
    });
    setIsDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingDownloader(null);
    form.reset({
      name: "",
      type: "transmission",
      url: "",
      username: "",
      password: "",
      enabled: true,
      priority: 1,
      downloadPath: "",
      category: "games",
      settings: "",
    });
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading downloaders...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Downloaders</h1>
          <p className="text-muted-foreground">Manage torrent clients for automated downloads</p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-downloader">
          <Plus className="h-4 w-4 mr-2" />
          Add Downloader
        </Button>
      </div>

      <div className="grid gap-4">
        {downloaders && downloaders.length > 0 ? (
          downloaders.map((downloader: Downloader) => (
            <Card key={downloader.id} data-testid={`card-downloader-${downloader.id}`}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center space-x-3">
                    <CardTitle className="text-lg">{downloader.name}</CardTitle>
                    <Badge variant="outline" className="capitalize">
                      {downloader.type}
                    </Badge>
                    <Badge
                      variant={downloader.enabled ? "default" : "secondary"}
                      data-testid={`status-downloader-${downloader.id}`}
                    >
                      {downloader.enabled ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Enabled
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3 mr-1" />
                          Disabled
                        </>
                      )}
                    </Badge>
                    <Badge variant="outline">Priority {downloader.priority}</Badge>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={downloader.enabled}
                      onCheckedChange={(enabled) =>
                        toggleEnabledMutation.mutate({ id: downloader.id, enabled })
                      }
                      data-testid={`switch-downloader-enabled-${downloader.id}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(downloader)}
                      data-testid={`button-edit-downloader-${downloader.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => deleteMutation.mutate(downloader.id)}
                      data-testid={`button-delete-downloader-${downloader.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription>{downloader.url}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {downloader.downloadPath && (
                    <Badge variant="outline">
                      Path: {downloader.downloadPath}
                    </Badge>
                  )}
                  {downloader.category && (
                    <Badge variant="outline">
                      Category: {downloader.category}
                    </Badge>
                  )}
                  {downloader.username && (
                    <Badge variant="outline">Authenticated</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No Downloaders Configured</CardTitle>
              <CardDescription>
                Add your first downloader client to enable automated downloads. Supported clients include Transmission, qBittorrent, rTorrent, uTorrent, and Vuze.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingDownloader ? "Edit Downloader" : "Add Downloader"}
            </DialogTitle>
            <DialogDescription>
              Configure a torrent client for automated game downloads.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Transmission"
                        {...field}
                        data-testid="input-downloader-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-downloader-type">
                          <SelectValue placeholder="Select client type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {downloaderTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="http://localhost:9091/transmission/rpc"
                        {...field}
                        data-testid="input-downloader-url"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter username"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-downloader-username"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter password"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-downloader-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="downloadPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Download Path (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="/home/downloads/games"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-downloader-path"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        data-testid="input-downloader-priority"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-downloader"
                >
                  {addMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingDownloader
                    ? "Update"
                    : "Add"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}