import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeOff, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UserSettings } from "@shared/schema";
import { PlatformPicker, type IgdbPlatform } from "./PlatformPicker";

/**
 * Settings section for hiding platforms from the Library platform filter.
 *
 * Reuses the same IGDB platform picker as Settings → Import → Platform Filter.
 * Stored as platform *names* (matching how `games.platforms` is persisted) so
 * the Library can filter without a second IGDB lookup; the picker works in IDs,
 * so names are translated on load and save.
 */
export default function HiddenPlatformsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
  });
  const { data: igdbPlatformsData, isLoading: platformsLoading } = useQuery<IgdbPlatform[]>({
    queryKey: ["/api/igdb/platforms"],
  });
  const igdbPlatforms = useMemo(
    () => (Array.isArray(igdbPlatformsData) ? igdbPlatformsData : []),
    [igdbPlatformsData]
  );

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const loadedRef = useRef(false);

  // Seed the picker once both the saved settings and the platform list are
  // available, so a later refetch doesn't discard in-progress edits. Waiting
  // for `settings` matters: the platform list may resolve first, and seeding
  // from an undefined settings object would latch an empty selection.
  useEffect(() => {
    if (loadedRef.current || !settings || igdbPlatforms.length === 0) return;
    const hidden = new Set(settings.hiddenPlatforms ?? []);
    setSelectedIds(igdbPlatforms.filter((p) => hidden.has(p.name)).map((p) => p.id));
    loadedRef.current = true;
  }, [settings, igdbPlatforms]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (hiddenPlatforms: string[]) => {
      await apiRequest("PATCH", "/api/settings", { hiddenPlatforms });
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Hidden platforms updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => {
      toast({
        title: "Save Failed",
        description: "Could not update hidden platforms.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    // Without the stored settings we cannot tell which names IGDB no longer
    // reports, so saving would silently drop them.
    if (!settings) return;
    const knownNames = new Set(igdbPlatforms.map((p) => p.name));
    const selectedNames = igdbPlatforms
      .filter((p) => selectedIds.includes(p.id))
      .map((p) => p.name);
    // Keep any stored name IGDB no longer reports, so an upstream rename can't
    // silently un-hide a platform.
    const preserved = (settings.hiddenPlatforms ?? []).filter((n) => !knownNames.has(n));
    updateSettingsMutation.mutate([...preserved, ...selectedNames].sort());
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <EyeOff className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Hidden Platforms</CardTitle>
        </div>
        <CardDescription>
          Hide platforms from the Library platform filter. Hidden platforms stay in your library —
          this only declutters the dropdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Uses the same platform list as Settings → Import → Platform Filter. Empty = show every
          platform.
        </p>
        <PlatformPicker
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          idPrefix="hidden-platform"
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!settings || updateSettingsMutation.isPending}>
            {updateSettingsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
        {platformsLoading && (
          <p className="text-xs text-muted-foreground">Loading platform list...</p>
        )}
      </CardContent>
    </Card>
  );
}
