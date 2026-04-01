import React, { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users, X, Plus, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PreferredReleaseGroupsSettingsProps {
  preferredGroups: string[];
  filterByPreferredGroups: boolean;
  onGroupsChange: (groups: string[]) => void;
  onFilterChange: (enabled: boolean) => void;
}

export default function PreferredReleaseGroupsSettings({
  preferredGroups,
  filterByPreferredGroups,
  onGroupsChange,
  onFilterChange,
}: PreferredReleaseGroupsSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [groups, setGroups] = useState<string[]>(preferredGroups);
  const [filterEnabled, setFilterEnabled] = useState(filterByPreferredGroups);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    setGroups(preferredGroups);
    setFilterEnabled(filterByPreferredGroups);
  }, [preferredGroups, filterByPreferredGroups]);

  useEffect(() => {
    onGroupsChange(groups);
  }, [groups, onGroupsChange]);

  useEffect(() => {
    onFilterChange(filterEnabled);
  }, [filterEnabled, onFilterChange]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings", {
        preferredReleaseGroups: JSON.stringify(groups),
        filterByPreferredGroups: filterEnabled,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Release Groups Saved",
        description: "Your preferred release group settings have been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddGroup = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (groups.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      setInputValue("");
      return;
    }
    setGroups((prev) => [...prev, trimmed]);
    setInputValue("");
  }, [inputValue, groups]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddGroup();
    }
  };

  const handleRemoveGroup = (group: string) => {
    setGroups((prev) => prev.filter((g) => g !== group));
  };

  const handleReset = () => {
    setGroups([]);
    setFilterEnabled(false);
    setInputValue("");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Users className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Preferred Release Groups</CardTitle>
        </div>
        <CardDescription>
          Prioritize releases from specific groups during auto-download. When matches are found,
          only those releases will be considered.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {/* Group input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Release Group Names</Label>
            <div className="flex gap-2">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. CODEX, SKIDROW, EMPRESS..."
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddGroup}
                disabled={!inputValue.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter or click + to add a group. Comparison is case-insensitive.
            </p>
          </div>

          {/* Group tags */}
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <Badge key={group} variant="secondary" className="gap-1 pr-1">
                  {group}
                  <button
                    type="button"
                    onClick={() => handleRemoveGroup(group)}
                    className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    aria-label={`Remove ${group}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No preferred groups configured. All groups will be considered equally.
            </p>
          )}

          {/* Pre-filter toggle */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="space-y-0.5">
              <Label htmlFor="filter-by-groups" className="text-sm font-medium">
                Pre-filter Download Search
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically filter the download dialog to show only preferred groups
              </p>
            </div>
            <Switch
              id="filter-by-groups"
              checked={filterEnabled}
              onCheckedChange={setFilterEnabled}
              disabled={groups.length === 0}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? (
              <>
                <Save className="h-4 w-4 animate-pulse" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Groups
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
