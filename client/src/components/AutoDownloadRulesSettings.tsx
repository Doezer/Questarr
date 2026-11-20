import React, { useState, useEffect, useMemo } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DownloadRules } from "@shared/schema";
import type { DownloadCategory } from "@shared/download-categorizer";

interface AutoDownloadRulesSettingsProps {
  rules: DownloadRules | null;
  onChange: (rules: DownloadRules) => void;
  onReset: () => void;
}

const CATEGORY_DEFINITIONS = [
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
    value: "packs",
    label: "Packs/Addons",
    description: "Game packs and add-ons",
  },
  {
    value: "extra",
    label: "Extras",
    description: "Soundtracks, artbooks, and bonus content",
  },
] as const;

const DEFAULT_RULES: DownloadRules = {
  minSeeders: 0,
  sortBy: "seeders",
  visibleCategories: ["main", "update", "dlc", "extra", "packs"],
  hideRejected: true,
  autoPickBest: false,
  upgradeCutoffScore: null,
  upgradeMinScoreGain: 10,
  upgradePreferPatches: false,
  bundleExtraMaxPercent: 25,
};

// Shown when the swap is first turned on: the built-in rules put a clean scene or GOG release
// around 150 points.
const DEFAULT_UPGRADE_CUTOFF = 150;

const CUTOFF_RANGE = { min: -10000, max: 10000 } as const;
const GAIN_RANGE = { min: 1, max: 10000 } as const;
const BUNDLE_PERCENT_RANGE = { min: 1, max: 100 } as const;

/** The integer a field holds, clamped to its range; null while it is empty or just a sign. */
function parseClampedInt(value: string, range: { min: number; max: number }): number | null {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(range.max, Math.max(range.min, parsed));
}

/** Keeps what is being typed when it already means `value`, else shows `value`. */
function syncedText(text: string, value: number, range: { min: number; max: number }): string {
  return parseClampedInt(text, range) === value ? text : String(value);
}

export default function AutoDownloadRulesSettings({
  rules,
  onChange,
  onReset,
}: AutoDownloadRulesSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [minSeeders, setMinSeeders] = useState<number>(rules?.minSeeders ?? 0);
  const [sortBy, setSortBy] = useState<"score" | "seeders" | "date" | "size" | "priority">(
    rules?.sortBy ?? "seeders"
  );
  const [hideRejected, setHideRejected] = useState<boolean>(rules?.hideRejected ?? true);
  const [autoPickBest, setAutoPickBest] = useState<boolean>(rules?.autoPickBest ?? false);
  const [upgradeCutoffScore, setUpgradeCutoffScore] = useState<number | null>(
    rules?.upgradeCutoffScore ?? null
  );
  const [upgradeMinScoreGain, setUpgradeMinScoreGain] = useState<number>(
    rules?.upgradeMinScoreGain ?? 10
  );
  const [upgradePreferPatches, setUpgradePreferPatches] = useState<boolean>(
    rules?.upgradePreferPatches ?? false
  );
  const [bundleExtraMaxPercent, setBundleExtraMaxPercent] = useState<number>(
    rules?.bundleExtraMaxPercent ?? 25
  );
  const [bundlePercentText, setBundlePercentText] = useState<string>(
    String(rules?.bundleExtraMaxPercent ?? 25)
  );
  // What is typed in the two number fields: kept apart from the values so a field can be
  // emptied, or start with a minus sign, without snapping back to a default mid-edit.
  const [cutoffText, setCutoffText] = useState<string>(
    String(rules?.upgradeCutoffScore ?? DEFAULT_UPGRADE_CUTOFF)
  );
  const [gainText, setGainText] = useState<string>(String(rules?.upgradeMinScoreGain ?? 10));
  const [visibleCategories, setVisibleCategories] = useState<Set<DownloadCategory>>(
    new Set(
      (rules?.visibleCategories ?? [
        "main",
        "update",
        "dlc",
        "extra",
        "packs",
      ]) as DownloadCategory[]
    )
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
    const source = rules ?? DEFAULT_RULES;
    setMinSeeders(source.minSeeders);
    setSortBy(source.sortBy);
    setHideRejected(source.hideRejected);
    setAutoPickBest(source.autoPickBest ?? false);
    setUpgradeCutoffScore(source.upgradeCutoffScore ?? null);
    setUpgradeMinScoreGain(source.upgradeMinScoreGain ?? 10);
    const cutoff = source.upgradeCutoffScore;
    if (cutoff !== null && cutoff !== undefined) {
      setCutoffText((prev) => syncedText(prev, cutoff, CUTOFF_RANGE));
    }
    setGainText((prev) => syncedText(prev, source.upgradeMinScoreGain ?? 10, GAIN_RANGE));
    setUpgradePreferPatches(source.upgradePreferPatches ?? false);
    setBundleExtraMaxPercent(source.bundleExtraMaxPercent ?? 25);
    setBundlePercentText((prev) =>
      syncedText(prev, source.bundleExtraMaxPercent ?? 25, BUNDLE_PERCENT_RANGE)
    );

    // Only update set if the content has changed to avoid infinite loop
    setVisibleCategories((prev) => {
      const newSet = new Set(source.visibleCategories as DownloadCategory[]);
      if (prev.size === newSet.size && Array.from(newSet).every((val) => prev.has(val))) {
        return prev;
      }
      return newSet;
    });
  }, [rules]);

  // Automatically apply changes to parent component when local state changes
  const currentRules = useMemo<DownloadRules>(
    () => ({
      minSeeders,
      sortBy,
      visibleCategories: Array.from(visibleCategories),
      hideRejected,
      autoPickBest,
      upgradeCutoffScore,
      upgradeMinScoreGain,
      upgradePreferPatches,
      bundleExtraMaxPercent,
    }),
    [
      minSeeders,
      sortBy,
      visibleCategories,
      hideRejected,
      autoPickBest,
      upgradeCutoffScore,
      upgradeMinScoreGain,
      upgradePreferPatches,
      bundleExtraMaxPercent,
    ]
  );

  useEffect(() => {
    onChange(currentRules);
  }, [currentRules, onChange]);

  const handleCategoryChange = (category: DownloadCategory) => {
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

  const handleSortByChange = (value: "score" | "seeders" | "date" | "size" | "priority") => {
    setSortBy(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <CardTitle as="h2" className="text-lg">
            Download Rules
          </CardTitle>
        </div>
        <CardDescription>
          These filters will be used as defaults when you open the manual download dialog, and
          applied to auto-searches.
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
              onChange={(e) => handleMinSeedersChange(Number.parseInt(e.target.value) || 0)}
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
              onValueChange={(v) =>
                handleSortByChange(v as "score" | "seeders" | "date" | "size" | "priority")
              }
            >
              <SelectTrigger id="sortBy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Release Score (Best First)</SelectItem>
                <SelectItem value="seeders">Seeders (High to Low)</SelectItem>
                <SelectItem value="date">Date (Newest First)</SelectItem>
                <SelectItem value="size">Size (Largest First)</SelectItem>
                <SelectItem value="priority">Indexer Priority</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How to sort results within each category
            </p>
          </div>

          {/* Rejected releases */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="hideRejected"
              checked={hideRejected}
              onCheckedChange={(checked) => setHideRejected(checked === true)}
              className="mt-1"
            />
            <label htmlFor="hideRejected" className="flex-1 cursor-pointer text-sm leading-tight">
              <div className="font-medium">Hide rejected releases</div>
              <div className="text-xs text-muted-foreground">
                Leave out releases your scoring profile rejects, such as another game with the same
                group name
              </div>
            </label>
          </div>

          {/* Best release among several */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="autoPickBest"
              checked={autoPickBest}
              onCheckedChange={(checked) => setAutoPickBest(checked === true)}
              className="mt-1"
            />
            <label htmlFor="autoPickBest" className="flex-1 cursor-pointer text-sm leading-tight">
              <div className="font-medium">Auto-download the best-scored release</div>
              <div className="text-xs text-muted-foreground">
                When auto-download finds several releases for a wanted game, take the one your
                scoring profile ranks first. Off: it only downloads when a single release is left,
                and asks you to choose otherwise.
              </div>
            </label>
          </div>

          {/* Same-version swaps of the "Download automatically" update policy */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="upgradeSwap"
                checked={upgradeCutoffScore !== null}
                onCheckedChange={(checked) => {
                  setUpgradeCutoffScore(checked === true ? DEFAULT_UPGRADE_CUTOFF : null);
                  if (checked === true) setCutoffText(String(DEFAULT_UPGRADE_CUTOFF));
                }}
                className="mt-1"
              />
              <label htmlFor="upgradeSwap" className="flex-1 cursor-pointer text-sm leading-tight">
                <div className="font-medium">Replace owned releases with better-scored ones</div>
                <div className="text-xs text-muted-foreground">
                  For owned games set to Download automatically: when a release of the installed
                  version scores better than the one you downloaded, take it. Off: only newer
                  versions are downloaded.
                </div>
              </label>
            </div>
            {upgradeCutoffScore !== null && (
              <div className="grid gap-4 border-l-2 pl-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="upgradeCutoffScore" className="text-sm font-medium">
                    Stop at score
                  </Label>
                  <Input
                    id="upgradeCutoffScore"
                    type="number"
                    inputMode="numeric"
                    min="-10000"
                    max="10000"
                    value={cutoffText}
                    onChange={(e) => {
                      setCutoffText(e.target.value);
                      const parsed = parseClampedInt(e.target.value, CUTOFF_RANGE);
                      if (parsed !== null) setUpgradeCutoffScore(parsed);
                    }}
                    onBlur={() => setCutoffText(String(upgradeCutoffScore))}
                    className="h-10 w-full sm:h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    Once the installed release scores this much, it is kept
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="upgradeMinScoreGain" className="text-sm font-medium">
                    Minimum score gain
                  </Label>
                  <Input
                    id="upgradeMinScoreGain"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="10000"
                    value={gainText}
                    onChange={(e) => {
                      setGainText(e.target.value);
                      const parsed = parseClampedInt(e.target.value, GAIN_RANGE);
                      if (parsed !== null) setUpgradeMinScoreGain(parsed);
                    }}
                    onBlur={() => setGainText(String(upgradeMinScoreGain))}
                    className="h-10 w-full sm:h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    How many points better a release must score to replace yours
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Update-only patches for the "Download automatically" update policy */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="upgradePreferPatches"
              checked={upgradePreferPatches}
              onCheckedChange={(checked) => setUpgradePreferPatches(checked === true)}
              className="mt-1"
            />
            <label
              htmlFor="upgradePreferPatches"
              className="flex-1 cursor-pointer text-sm leading-tight"
            >
              <div className="font-medium">Prefer update-only releases</div>
              <div className="text-xs text-muted-foreground">
                For owned games set to Download automatically: when a patch names the installed
                version as its starting point, take it over a full release of the same new version
                (a much smaller download). Off: full releases come first.
              </div>
            </label>
          </div>

          {/* Size-aware extras in the manual download dialog */}
          <div className="space-y-2">
            <Label htmlFor="bundleExtraMaxPercent" className="text-sm font-medium">
              Suggest extras up to (% of the game's size)
            </Label>
            <Input
              id="bundleExtraMaxPercent"
              type="number"
              inputMode="numeric"
              min="1"
              max="100"
              value={bundlePercentText}
              onChange={(e) => {
                setBundlePercentText(e.target.value);
                const parsed = parseClampedInt(e.target.value, BUNDLE_PERCENT_RANGE);
                if (parsed !== null) setBundleExtraMaxPercent(parsed);
              }}
              onBlur={() => setBundlePercentText(String(bundleExtraMaxPercent))}
              className="h-10 w-full sm:h-9 sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              When you download a game, DLC and extras this small next to it are offered as optional
              choices (never ticked). Larger ones, or ones with no known size, are not suggested.
            </p>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Content Types to Show</Label>
            <div className="space-y-2">
              {CATEGORY_DEFINITIONS.map((cat) => (
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
              {visibleCategories.size} of {CATEGORY_DEFINITIONS.length} categories enabled
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
            onClick={() => saveRulesMutation.mutate(currentRules)}
            disabled={saveRulesMutation.isPending}
            className="gap-2"
          >
            {saveRulesMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
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
