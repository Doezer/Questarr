import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { asZodType } from "@/lib/utils";
import { Plus, Edit, Trash2, Check, X, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertIndexerSchema, type Indexer, type InsertIndexer } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";

export default function IndexersPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndexer, setEditingIndexer] = useState<Indexer | null>(null);
  const [testingIndexerId, setTestingIndexerId] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<MultiSelectOption[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  const { data: indexers = [], isLoading } = useQuery<Indexer[]>({
    queryKey: ["/api/indexers"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: InsertIndexer) => {
      const response = await fetch("/api/indexers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to add indexer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/indexers"] });
      setIsDialogOpen(false);
      setEditingIndexer(null);
      toast({ title: "Indexer added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add indexer", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertIndexer> }) => {
      const response = await fetch(`/api/indexers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update indexer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/indexers"] });
      setIsDialogOpen(false);
      setEditingIndexer(null);
      toast({ title: "Indexer updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update indexer", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/indexers/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete indexer");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/indexers"] });
      toast({ title: "Indexer deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete indexer", variant: "destructive" });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await fetch(`/api/indexers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle indexer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/indexers"] });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/indexers/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to test indexer connection");
      }
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onMutate: (id) => {
      setTestingIndexerId(id);
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
        variant: "destructive" 
      });
    },
    onSettled: () => {
      setTestingIndexerId(null);
    },
  });

  const form = useForm<InsertIndexer>({
    resolver: zodResolver(asZodType<InsertIndexer>(insertIndexerSchema)),
    defaultValues: {
      name: "",
      url: "",
      apiKey: "",
      enabled: true,
      priority: 1,
      categories: [],
      rssEnabled: true,
      autoSearchEnabled: true,
    },
  });

  const onSubmit = (data: InsertIndexer) => {
    if (editingIndexer) {
      updateMutation.mutate({ id: editingIndexer.id, data });
    } else {
      addMutation.mutate(data);
    }
  };

  const fetchCategories = async (indexerId: string) => {
    setLoadingCategories(true);
    try {
      const response = await fetch(`/api/indexers/${indexerId}/categories`);
      if (response.ok) {
        const categories = await response.json() as { id: string; name: string }[];
        setAvailableCategories(
          categories.map((cat) => ({
            label: `${cat.name} (${cat.id})`,
            value: cat.id,
          }))
        );
      } else {
        toast({
          title: "Failed to fetch categories",
          description: "Using manual input instead",
          variant: "destructive",
        });
        setAvailableCategories([]);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast({
        title: "Failed to fetch categories",
        description: "Using manual input instead",
        variant: "destructive",
      });
      setAvailableCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleEdit = (indexer: Indexer) => {
    setEditingIndexer(indexer);
    form.reset({
      name: indexer.name,
      url: indexer.url,
      apiKey: indexer.apiKey,
      enabled: indexer.enabled,
      priority: indexer.priority,
      categories: indexer.categories || [],
      rssEnabled: indexer.rssEnabled,
      autoSearchEnabled: indexer.autoSearchEnabled,
    });
    setIsDialogOpen(true);
    // Fetch available categories from the indexer
    fetchCategories(indexer.id);
  };

  const handleAdd = () => {
    setEditingIndexer(null);
    form.reset({
      name: "",
      url: "",
      apiKey: "",
      enabled: true,
      priority: 1,
      categories: [],
      rssEnabled: true,
      autoSearchEnabled: true,
    });
    setAvailableCategories([]);
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading indexers...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Indexers</h1>
          <p className="text-muted-foreground">Manage Torznab indexers for game discovery</p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-indexer">
          <Plus className="h-4 w-4 mr-2" />
          Add Indexer
        </Button>
      </div>

      <div className="grid gap-4">
        {indexers && indexers.length > 0 ? (
          indexers.map((indexer: Indexer) => (
            <Card key={indexer.id} data-testid={`card-indexer-${indexer.id}`}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center space-x-3">
                    <CardTitle className="text-lg">{indexer.name}</CardTitle>
                    <Badge
                      variant={indexer.enabled ? "default" : "secondary"}
                      data-testid={`status-indexer-${indexer.id}`}
                    >
                      {indexer.enabled ? (
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
                    <Badge variant="outline">Priority {indexer.priority}</Badge>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => testConnectionMutation.mutate(indexer.id)}
                      disabled={testingIndexerId === indexer.id}
                      title="Test connection"
                      data-testid={`button-test-indexer-${indexer.id}`}
                    >
                      <Activity className="h-4 w-4" />
                    </Button>
                    <Switch
                      checked={indexer.enabled}
                      onCheckedChange={(enabled) =>
                        toggleEnabledMutation.mutate({ id: indexer.id, enabled })
                      }
                      data-testid={`switch-indexer-enabled-${indexer.id}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(indexer)}
                      data-testid={`button-edit-indexer-${indexer.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => deleteMutation.mutate(indexer.id)}
                      data-testid={`button-delete-indexer-${indexer.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription>{indexer.url}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {indexer.rssEnabled && (
                    <Badge variant="outline">RSS Enabled</Badge>
                  )}
                  {indexer.autoSearchEnabled && (
                    <Badge variant="outline">Auto Search</Badge>
                  )}
                  {indexer.categories && indexer.categories.length > 0 && (
                    <Badge variant="outline">
                      {indexer.categories.length} Categories
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No Indexers Configured</CardTitle>
              <CardDescription>
                Add your first Torznab indexer to start discovering games. Popular options include Jackett, Prowlarr, or direct Torznab-compatible trackers.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingIndexer ? "Edit Indexer" : "Add Indexer"}
            </DialogTitle>
            <DialogDescription>
              Configure a Torznab indexer for game discovery and downloads.
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
                        placeholder="Jackett"
                        {...field}
                        data-testid="input-indexer-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Torznab URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="http://localhost:9117/api/v2.0/indexers/all/results/torznab/"
                        {...field}
                        data-testid="input-indexer-url"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter API key"
                        {...field}
                        data-testid="input-indexer-apikey"
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
                        data-testid="input-indexer-priority"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categories"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categories</FormLabel>
                    <FormControl>
                      <MultiSelect
                        options={availableCategories}
                        selected={field.value || []}
                        onChange={field.onChange}
                        placeholder={
                          loadingCategories
                            ? "Loading categories..."
                            : availableCategories.length > 0
                            ? "Select categories..."
                            : "Save indexer first to load categories"
                        }
                        emptyMessage="No categories available"
                        disabled={loadingCategories || (!editingIndexer && availableCategories.length === 0)}
                        data-testid="multi-select-categories"
                      />
                    </FormControl>
                    <FormDescription>
                      {editingIndexer
                        ? "Select the Torznab categories to search. Leave empty to use all available categories."
                        : "Add the indexer first, then edit it to select categories."}
                    </FormDescription>
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
                  data-testid="button-save-indexer"
                >
                  {addMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingIndexer
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