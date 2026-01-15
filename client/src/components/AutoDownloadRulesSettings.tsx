import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Filter, RotateCcw, Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DownloadRules } from "@shared/schema";

interface AutoDownloadRulesSettingsProps {
  rules: DownloadRules | null;
  onChange: (rules: DownloadRules) => void;
  onReset: () => void;
}

const DEFAULT_RULES: DownloadRules = {
  minSeeders: 0,
  sortBy: "seeders",
  visibleCategories: ["main", "update", "dlc", "extra"],
};

export default function AutoDownloadRulesSettings({
  rules,
  onChange,
  onReset,
}: AutoDownloadRulesSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [minSeeders, setMinSeeders] = useState<number>(rules?.minSeeders ?? 0);
  const [sortBy, setSortBy] = useState<"seeders" | "date" | "size">(
    rules?.sortBy ?? "seeders"
  );
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(
    new Set(rules?.visibleCategories ?? ["main", "update", "dlc", "extra"])
  );

  const saveRulesMutation = useMutation({
    mutationFn: async (rulesToSave: DownloadRules) => {
      const res = await apiRequest("PATCH", "/api/settings", {
        downloadRules: JSON.stringify(rulesToSave),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Download Rules Saved",
        description: "Your download filter rules have been saved.",
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

  // Update local state when rules prop changes from parent
  useEffect(() => {
    if (rules) {
      setMinSeeders((prev) => (prev !== rules.minSeeders ? rules.minSeeders : prev));
      setSortBy((prev) => (prev !== rules.sortBy ? rules.sortBy : prev));
      setVisibleCategories((prev) => {
        const newSet = new Set(rules.visibleCategories);
        if (prev.size === newSet.size && Array.from(newSet).every((val) => prev.has(val))) {
          return prev;
        }
        return newSet;
      });
    } else {
      // Reset to defaults if rules are null
      const def = DEFAULT_RULES;
      setMinSeeders((prev) => (prev !== def.minSeeders ? def.minSeeders : prev));
      setSortBy((prev) => (prev !== def.sortBy ? def.sortBy : prev));
      setVisibleCategories((prev) => {
        const defSet = new Set(def.visibleCategories);
        if (prev.size === defSet.size && Array.from(defSet).every((val) => prev.has(val))) {
          return prev;
        }
        return defSet;
      });
    }
  }, [rules]);

  // Automatically apply changes to parent component when local state changes
  useEffect(() => {
    onChange({
      minSeeders,
      sortBy,
      visibleCategories: Array.from(visibleCategories) as ("main" | "update" | "dlc" | "extra")[],
    });
  }, [minSeeders, sortBy, visibleCategories, onChange]);

  const handleCategoryChange = (category: string) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleReset = () => {
    // The parent will set rules to null, which will trigger the useEffect to reset state.
    onReset();
  };

  const handleMinSeedersChange = (value: number) => {
    setMinSeeders(value);
  };

  const handleSortByChange = (value: "seeders" | "date" | "size") => {
    setSortBy(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Download Rules</CardTitle>
        </div>
        <CardDescription>
          These filters will be used as defaults when you open the manual download dialog, and applied to auto-searches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {/* Min Seeders */}
          <div className="space-y-2">
            <Label htmlFor="minSeeders" className="text-sm font-medium">
              Minimum Seeders
            </Label>
            <Input
              id="minSeeders"
              type="number"
              min="0"
              max="1000"
              value={minSeeders}
              onChange={(e) => handleMinSeedersChange(parseInt(e.target.value) || 0)}
              className="w-full"
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Only show torrents with at least this many seeders (0 = no minimum)
            </p>
          </div>

          {/* Sort By */}
          <div className="space-y-2">
            <Label htmlFor="sortBy" className="text-sm font-medium">
              Default Sort Order
            </Label>
            <Select
              value={sortBy}
              onValueChange={(v) => handleSortByChange(v as "seeders" | "date" | "size")}
            >
              <SelectTrigger id="sortBy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seeders">Seeders (High to Low)</SelectItem>
                <SelectItem value="date">Date (Newest First)</SelectItem>
                <SelectItem value="size">Size (Largest First)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How to sort results within each category
            </p>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Content Types to Show</Label>
            <div className="space-y-2">
              {[
                { value: "main", label: "Main Game", description: "Full game downloads" },
                {
                  value: "update",
                  label: "Updates & Patches",
                  description: "Game updates, patches, and hotfixes",
                },
                {
                  value: "dlc",
                  label: "DLC & Expansions",
                  description: "Downloadable content and season passes",
                },
                {
                  value: "extra",
                  label: "Extras",
                  description: "Soundtracks, artbooks, and bonus content",
                },
              ].map((cat) => (
                <div key={cat.value} className="flex items-start gap-3">
                  <Checkbox
                    id={`cat-${cat.value}`}
                    checked={visibleCategories.has(cat.value)}
                    onCheckedChange={() => handleCategoryChange(cat.value)}
                    className="mt-1"
                  />
                  <label
                    htmlFor={`cat-${cat.value}`}
                    className="flex-1 cursor-pointer text-sm leading-tight"
                  >
                    <div className="font-medium">{cat.label}</div>
                    <div className="text-xs text-muted-foreground">{cat.description}</div>
                  </label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {visibleCategories.size} of 4 categories enabled
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={saveRulesMutation.isPending}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button
            onClick={() => {
              const rulesToSave = {
                minSeeders,
                sortBy,
                visibleCategories: Array.from(visibleCategories) as (
                  "main" | "update" | "dlc" | "extra"
                )[],
              };
              saveRulesMutation.mutate(rulesToSave);
            }}
            disabled={saveRulesMutation.isPending}
            className="gap-2"
          >
            {saveRulesMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Save Rules
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
