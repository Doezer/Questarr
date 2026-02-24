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
import { Plus, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PlatformMapping } from "@shared/schema";

export function PlatformMappingSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({ igdbPlatformId: "", rommPlatformName: "" });

  const { data: mappings, isLoading } = useQuery<PlatformMapping[]>({
    queryKey: ["/api/imports/mappings/platforms"],
  });

  const addMutation = useMutation({
    mutationFn: async (mapping: { igdbPlatformId: number; rommPlatformName: string }) => {
      await apiRequest("POST", "/api/imports/mappings/platforms", mapping);
    },
    onSuccess: () => {
      toast({ title: "Mapping Added", description: "New platform mapping has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/platforms"] });
      setIsAddDialogOpen(false);
      setNewMapping({ igdbPlatformId: "", rommPlatformName: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/imports/mappings/platforms/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Mapping Deleted", description: "Platform mapping has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/platforms"] });
    },
  });

  const initDefaultsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/imports/mappings/platforms/init", {});
      return (await res.json()) as { count?: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Defaults Initialized",
        description: `Added ${data.count || 0} default mappings.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/mappings/platforms"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newMapping.igdbPlatformId || !newMapping.rommPlatformName) {
      toast({
        title: "Validation Error",
        description: "All fields are required.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate({
      igdbPlatformId: parseInt(newMapping.igdbPlatformId),
      rommPlatformName: newMapping.rommPlatformName,
    });
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Platform Mappings</CardTitle>
            <CardDescription>Map IGDB Platform IDs to RomM folder names (slugs).</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => initDefaultsMutation.mutate()}
              disabled={initDefaultsMutation.isPending}
            >
              {initDefaultsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Init Defaults
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> Add Mapping
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Platform Mapping</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>IGDB Platform ID</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 6 (PC)"
                      value={newMapping.igdbPlatformId}
                      onChange={(e) =>
                        setNewMapping({ ...newMapping, igdbPlatformId: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>RomM Platform Name (Slug)</Label>
                    <Input
                      placeholder="e.g. pc"
                      value={newMapping.rommPlatformName}
                      onChange={(e) =>
                        setNewMapping({ ...newMapping, rommPlatformName: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleCreate}
                    disabled={addMutation.isPending}
                  >
                    {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Mapping
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IGDB ID</TableHead>
              <TableHead>RomM Name</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No mappings defined
                </TableCell>
              </TableRow>
            )}
            {mappings?.map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell>{mapping.igdbPlatformId}</TableCell>
                <TableCell className="font-mono text-xs">{mapping.rommPlatformName}</TableCell>
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
