import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gamepad2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UserSettings } from "@shared/schema";
import type { IgdbPlatform } from "@shared/platforms";
import { PlatformPicker } from "./PlatformPicker";

/**
 * Settings → Platforms.
 *
 * One selection governs every platform selector in the app: the Library
 * platform filter, the download-search platform filter, the Discover and
 * Add Game dropdowns, and the import engine's eligibility check.
 *
 * Checked platforms are the ones you use — everything unchecked is hidden.
 * Leaving the list empty means "no restriction" and shows every platform.
 */

/**
 * The persisted shape is `z.array(z.number().int().min(1))`. The settings API
 * returns stored JSON without revalidating it, so a hand-edited or legacy row
 * can hold a string, zero, a negative, or an unsafe integer. Saving such a
 * value back fails server validation, locking the user out of saving.
 */
function isSelectablePlatformId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

export default function PlatformsSettings() {
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
    const saved = settings.importPlatformIds;
    setSelectedIds(Array.isArray(saved) ? saved.filter(isSelectablePlatformId) : []);
    loadedRef.current = true;
  }, [settings, igdbPlatforms]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (importPlatformIds: number[]) => {
      await apiRequest("PATCH", "/api/settings", { importPlatformIds });
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Platform preferences updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => {
      toast({
        title: "Save Failed",
        description: "Could not update platform preferences.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    // Without the stored settings we cannot tell which saved ids IGDB no longer
    // reports, so saving would silently drop them.
    if (!settings) return;
    const knownIds = new Set(igdbPlatforms.map((p) => p.id));
    const selectedKnown = selectedIds.filter((id) => knownIds.has(id));
    // Keep any stored id IGDB no longer reports, so an upstream removal can't
    // silently widen the selection. Malformed members are dropped rather than
    // preserved: sending one back would fail schema validation on every save.
    const stored = Array.isArray(settings.importPlatformIds) ? settings.importPlatformIds : [];
    const preserved = stored.filter((id) => isSelectablePlatformId(id) && !knownIds.has(id));
    updateSettingsMutation.mutate(
      [...new Set([...preserved, ...selectedKnown])].sort((a, b) => a - b)
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Gamepad2 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Platforms</CardTitle>
        </div>
        <CardDescription>
          Choose the platforms you use. Only these appear in platform filters across the app, and
          only these are eligible for import. Leave everything unchecked to show all platforms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PlatformPicker
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          idPrefix="platform-preference"
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
