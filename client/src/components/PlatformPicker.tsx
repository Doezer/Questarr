import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { type RawgPlatform } from "@shared/platforms";
import { type Config } from "@shared/schema";

export interface PlatformPickerProps {
  selectedIds: number[];
  onSelectedIdsChange: (next: number[]) => void;
  idPrefix?: string;
  className?: string;
}

/**
 * Shared RAWG platform multi-select used by the Platforms setting and the
 * import tab's read-only summary. Owns the platform-list query, search box,
 * and loading/error/empty states; the caller owns persistence.
 */
export function PlatformPicker({
  selectedIds,
  onSelectedIdsChange,
  idPrefix = "primary-platform",
  className,
}: PlatformPickerProps) {
  const {
    data: rawgPlatformsData,
    isLoading: platformsLoading,
    isError: platformsError,
    refetch: refetchPlatforms,
  } = useQuery<RawgPlatform[]>({
    queryKey: ["/api/rawg/platforms"],
  });
  const rawgPlatforms = Array.isArray(rawgPlatformsData) ? rawgPlatformsData : [];
  const { data: appConfig } = useQuery<Config>({
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
    ? rawgPlatforms.filter((platform) =>
        platform.name.toLowerCase().includes(normalizedPlatformSearch)
      )
    : rawgPlatforms;

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <label htmlFor={`${idPrefix}-search`} className="sr-only">
        Search platforms
      </label>
      <Input
        id={`${idPrefix}-search`}
        placeholder="Search platforms..."
        value={platformSearch}
        onChange={(e) => setPlatformSearch(e.target.value)}
      />
      <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
        {platformsLoading && <p className="text-xs text-muted-foreground">Loading platforms...</p>}
        {platformsError && (
          <div className="space-y-2">
            <p className="text-xs text-amber-500">Could not load platform list from RAWG.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchPlatforms()}>
              Retry
            </Button>
          </div>
        )}
        {!platformsLoading && !platformsError && rawgPlatforms.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {appConfig?.rawg?.configured
              ? "RAWG returned no platforms. Try again in a few seconds."
              : "RAWG is not configured yet — add a free API key in Settings."}
          </p>
        )}
        {!platformsLoading &&
          !platformsError &&
          rawgPlatforms.length > 0 &&
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
