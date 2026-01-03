import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { asZodType } from "@/lib/utils";
import { Plus, Edit, Trash2, Check, X, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDownloaderSchema, type Downloader, type InsertDownloader } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const downloaderTypes = [
  { value: "transmission", label: "Transmission" },
  { value: "rtorrent", label: "rTorrent" },
  { value: "qbittorrent", label: "qBittorrent" },
] as const;

export default function DownloadersPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDownloader, setEditingDownloader] = useState<Downloader | null>(null);
  const [testingDownloaderId, setTestingDownloaderId] = useState<string | null>(null);

  const { data: downloaders = [], isLoading } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: InsertDownloader) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch("/api/downloaders", {
        method: "POST",
        headers,
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
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "PATCH",
        headers,
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
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "DELETE",
        headers,
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
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/downloaders/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle downloader");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloaders"] });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (data: { id?: string; formData?: InsertDownloader }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      if (data.id) {
        // Test existing downloader by ID
        const response = await fetch(`/api/downloaders/${data.id}/test`, {
          method: "POST",
          headers,
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to test downloader connection");
        }
        return response.json() as Promise<{ success: boolean; message: string }>;
      } else if (data.formData) {
        // Test with form data (new downloader)
        const response = await fetch(`/api/downloaders/test`, {
          method: "POST",
          headers,
          body: JSON.stringify(data.formData),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to test downloader connection");
        }
        return response.json() as Promise<{ success: boolean; message: string }>;
      } else {
        throw new Error("Either id or formData must be provided");
      }
    },
    onMutate: (data) => {
      setTestingDownloaderId(data.id || "new");
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Connection successful", description: data.message });
      } else {
        toast({ title: "Connection failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error) => {
      toast({
        title: "Test failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setTestingDownloaderId(null);
    },
  });

  const form = useForm<InsertDownloader>({
    resolver: zodResolver(asZodType<InsertDownloader>(insertDownloaderSchema)),
    defaultValues: {
      name: "",
      type: "transmission",
      url: "",
      port: undefined,
      useSsl: false,
      urlPath: "",
      username: "",
      password: "",
      enabled: true,
      priority: 1,
      downloadPath: "",
      category: "games",
      addStopped: false,
      removeCompleted: false,
      postImportCategory: "",
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
      port: downloader.port ?? undefined,
      useSsl: downloader.useSsl ?? false,
      urlPath: downloader.urlPath ?? "",
      username: downloader.username ?? "",
      password: downloader.password ?? "",
      enabled: downloader.enabled,
      priority: downloader.priority,
      downloadPath: downloader.downloadPath ?? "",
      category: downloader.category ?? "games",
      addStopped: downloader.addStopped ?? false,
      removeCompleted: downloader.removeCompleted ?? false,
      postImportCategory: downloader.postImportCategory ?? "",
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
      port: undefined,
      useSsl: false,
      urlPath: "",
      username: "",
      password: "",
      enabled: true,
      priority: 1,
      downloadPath: "",
      category: "games",
      addStopped: false,
      removeCompleted: false,
      postImportCategory: "",
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
    <div className="h-full overflow-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Downloaders</h1>
          <p className="text-muted-foreground">
            Manage torrent clients for automated downloads. Downloads are sent to enabled clients in
            priority order (lowest number first), with automatic fallback if a client fails.
          </p>
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
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => testConnectionMutation.mutate({ id: downloader.id })}
                      disabled={testingDownloaderId === downloader.id}
                      title="Test connection"
                      data-testid={`button-test-downloader-${downloader.id}`}
                    >
                      <Activity className="h-4 w-4" />
                    </Button>
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
                    <Badge variant="outline">Path: {downloader.downloadPath}</Badge>
                  )}
                  {downloader.category && (
                    <Badge variant="outline">Category: {downloader.category}</Badge>
                  )}
                  {downloader.username && <Badge variant="outline">Authenticated</Badge>}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No Downloaders Configured</CardTitle>
              <CardDescription>
                Add your first downloader client to enable automated downloads. Supported clients
                include Transmission, rTorrent, and qBittorrent.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingDownloader ? "Edit Downloader" : "Add Downloader"}</DialogTitle>
            <DialogDescription>
              Configure a torrent client for automated game downloads.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4 overflow-hidden"
            >
              <div className="overflow-y-auto px-1 space-y-3 max-h-[calc(90vh-12rem)]">
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
                      <FormLabel>
                        {form.watch("type") === "rtorrent" ? "Host URL" : "URL"}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            form.watch("type") === "rtorrent"
                              ? "localhost or 192.168.1.100"
                              : "http://localhost:9091/transmission/rpc"
                          }
                          {...field}
                          data-testid="input-downloader-url"
                        />
                      </FormControl>
                      {form.watch("type") === "rtorrent" && (
                        <FormDescription className="text-xs">
                          Enter hostname or IP address without protocol or port
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("type") === "rtorrent" && (
                  <>
                    <FormField
                      control={form.control}
                      name="port"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Port</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="80 or 443"
                              {...field}
                              value={field.value || ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value ? parseInt(e.target.value) : undefined
                                )
                              }
                              data-testid="input-downloader-port"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="useSsl"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                          <div className="space-y-0">
                            <FormLabel className="text-sm">Use SSL</FormLabel>
                            <FormDescription className="text-xs">Enable HTTPS</FormDescription>
                          </div>
                          <FormControl>
                            <Checkbox
                              checked={!!field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-downloader-usessl"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="urlPath"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL Path</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="RPC2 or plugins/rpc/rpc.php"
                              {...field}
                              value={field.value || ""}
                              data-testid="input-downloader-urlpath"
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Path to XMLRPC endpoint (e.g., "RPC2" or "plugins/rpc/rpc.php")
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
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
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="games"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-downloader-category"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Label for torrents in downloader
                      </FormDescription>
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
                      <FormDescription className="text-xs">
                        Lower = higher priority. Auto-fallback if fails.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
                  <h3 className="text-sm font-semibold mb-2">Advanced Settings</h3>
                  {form.watch("type") === "rtorrent" && (
                    <>
                      <FormField
                        control={form.control}
                        name="addStopped"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2 bg-background">
                            <div className="space-y-0">
                              <FormLabel className="text-sm">Add Stopped</FormLabel>
                              <FormDescription className="text-xs">
                                Add torrents in paused state
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Checkbox
                                checked={!!field.value}
                                onCheckedChange={field.onChange}
                                data-testid="checkbox-downloader-addstopped"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="removeCompleted"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2 bg-background">
                            <div className="space-y-0">
                              <FormLabel className="text-sm">Remove Completed</FormLabel>
                              <FormDescription className="text-xs">
                                Remove torrents from downloader after completion
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Checkbox
                                checked={!!field.value}
                                onCheckedChange={field.onChange}
                                data-testid="checkbox-downloader-removecompleted"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="postImportCategory"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Post-Import Category (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="completed-games"
                                {...field}
                                value={field.value || ""}
                                data-testid="input-downloader-postimportcategory"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Category after download completes
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const formData = form.getValues();

                    if (editingDownloader) {
                      // Test existing downloader
                      testConnectionMutation.mutate({ id: editingDownloader.id });
                    } else {
                      // Test with form data for new downloader
                      testConnectionMutation.mutate({ formData });
                    }
                  }}
                  disabled={testingDownloaderId !== null}
                  data-testid="button-test-connection-dialog"
                >
                  <Activity className="h-4 w-4 mr-2" />
                  {testingDownloaderId === "new" ? "Testing..." : "Test Connection"}
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
