import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ImportConfig } from "@shared/schema";

type IgdbPlatform = { id: number; name: string };
type AppConfig = { igdb?: { configured?: boolean } };

/**
 * Shared IGDB platform multi-select used by the import platform filter and the
 * library "hidden platforms" setting. Owns the platform-list query, search
 * box, and loading/error/empty states; the caller owns persistence.
 */
export function PlatformPicker({
  selectedIds,
  onSelectedIdsChange,
  idPrefix = "primary-platform",
  className,
}: {
  selectedIds: number[];
  onSelectedIdsChange: (next: number[]) => void;
  idPrefix?: string;
  className?: string;
}) {
  const {
    data: igdbPlatformsData,
    isLoading: platformsLoading,
    isError: platformsError,
    refetch: refetchPlatforms,
  } = useQuery<IgdbPlatform[]>({
    queryKey: ["/api/igdb/platforms"],
  });
  const igdbPlatforms = Array.isArray(igdbPlatformsData) ? igdbPlatformsData : [];
  const { data: appConfig } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
  });

  const [platformSearch, setPlatformSearch] = useState("");

  const togglePlatformId = (platformId: number) => {
    const next = selectedIds.includes(platformId)
      ? selectedIds.filter((id) => id !== platformId)
      : [...selectedIds, platformId].sort((a, b) => a - b);
    onSelectedIdsChange(next);
  };

  const normalizedPlatformSearch = platformSearch.trim().toLowerCase();
  const filteredPlatforms = normalizedPlatformSearch
    ? igdbPlatforms.filter((platform) =>
        platform.name.toLowerCase().includes(normalizedPlatformSearch)
      )
    : igdbPlatforms;

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Input
        placeholder="Search platforms..."
        value={platformSearch}
        onChange={(e) => setPlatformSearch(e.target.value)}
      />
      <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
        {platformsLoading && <p className="text-xs text-muted-foreground">Loading platforms...</p>}
        {platformsError && (
          <div className="space-y-2">
            <p className="text-xs text-amber-500">Could not load platform list from IGDB.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchPlatforms()}>
              Retry
            </Button>
          </div>
        )}
        {!platformsLoading && !platformsError && igdbPlatforms.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {appConfig?.igdb?.configured
              ? "IGDB returned no platforms. Try again in a few seconds."
              : "IGDB is not configured yet — platform filters unavailable."}
          </p>
        )}
        {!platformsLoading &&
          !platformsError &&
          igdbPlatforms.length > 0 &&
          filteredPlatforms.length === 0 && (
            <p className="text-xs text-muted-foreground">No platforms match your search.</p>
          )}
        {filteredPlatforms.map((platform) => (
          <div key={platform.id} className="flex items-center gap-2.5">
            <Checkbox
              id={`${idPrefix}-${platform.id}`}
              checked={selectedIds.includes(platform.id)}
              onCheckedChange={() => togglePlatformId(platform.id)}
            />
            <label htmlFor={`${idPrefix}-${platform.id}`} className="cursor-pointer text-sm">
              {platform.name}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { IgdbPlatform };
export type PlatformPickerConfig = Pick<ImportConfig, "importPlatformIds">;
