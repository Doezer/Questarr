import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { compareVersions, extractVersionFromReleaseName } from "@shared/version-utils";

interface InstalledVersionFieldProps {
  readonly gameId: string;
  readonly installedVersion: string | null;
  /** Release names of the game's downloads, mined for version suggestions. */
  readonly releaseNames: readonly string[];
}

const MAX_SUGGESTIONS = 6;

/** Distinct versions found in release names, newest first when they can be compared. */
export function getVersionSuggestions(
  releaseNames: readonly string[],
  current: string | null
): string[] {
  const seen = new Map<string, string>();
  for (const name of releaseNames) {
    const version = extractVersionFromReleaseName(name);
    if (version && !seen.has(version.toLowerCase())) seen.set(version.toLowerCase(), version);
  }
  const currentKey = current?.trim().toLowerCase();
  return (
    Array.from(seen.values())
      .filter((version) => version.toLowerCase() !== currentKey)
      // Newest first: compare the right-hand version against the left-hand one.
      .sort((left, right) => compareVersions(right, left) ?? 0)
      .slice(0, MAX_SUGGESTIONS)
  );
}

export default function InstalledVersionField({
  gameId,
  installedVersion,
  releaseNames,
}: InstalledVersionFieldProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(installedVersion ?? "");
  // A value entered while a save is in flight; sent once that save settles, so saves never
  // race and the latest value always lands last.
  const queued = useRef<{ value: string | null } | null>(null);

  // Follow the server value (another tab, a finished download detecting a newer version).
  useEffect(() => {
    setDraft(installedVersion ?? "");
  }, [gameId, installedVersion]);

  const mutation = useMutation<void, Error, string | null>({
    mutationFn: async (value) => {
      await apiRequest("PATCH", `/api/games/${gameId}/installed-version`, {
        installedVersion: value,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: () => {
      if (queued.current) return; // a newer value is about to be sent
      setDraft(installedVersion ?? "");
      toast({ description: "Failed to save the installed version", variant: "destructive" });
    },
    onSettled: (_data, _error, sent) => {
      const next = queued.current;
      queued.current = null;
      if (next && next.value !== sent) mutation.mutate(next.value);
    },
  });

  const suggestions = useMemo(
    () => getVersionSuggestions(releaseNames, draft),
    [releaseNames, draft]
  );

  const save = (value: string) => {
    const next = value.trim() || null;
    if (next === (installedVersion ?? null)) return;
    if (mutation.isPending) {
      // Enter then blur would otherwise send the same value twice before the refetch lands.
      queued.current = mutation.variables === next ? null : { value: next };
      return;
    }
    mutation.mutate(next);
  };

  const showSaved =
    !mutation.isPending && mutation.isSuccess && !!draft && draft === (installedVersion ?? "");

  return (
    <div data-testid="section-installed-version">
      <label htmlFor="installed-version" className="font-semibold mb-2 flex items-center gap-2">
        <Tag className="w-4 h-4" />
        Installed version
      </label>
      <div className="relative w-full max-w-sm">
        <Input
          id="installed-version"
          value={draft}
          maxLength={64}
          placeholder="Unknown (e.g. v1.2.3)"
          autoComplete="off"
          className="h-10 pr-9 sm:h-9"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save(draft);
            } else if (e.key === "Escape" && draft !== (installedVersion ?? "")) {
              e.stopPropagation();
              setDraft(installedVersion ?? "");
            }
          }}
          data-testid="input-installed-version"
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
          aria-live="polite"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-label="Saving" />}
          {showSaved && <Check className="w-4 h-4 text-emerald-500" aria-label="Saved" />}
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">From your downloads:</span>
          {suggestions.map((version) => (
            <Button
              key={version}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              aria-label={`Set installed version to ${version}`}
              disabled={mutation.isPending}
              // Keep focus in the input: its blur would otherwise save the typed draft and
              // disable these buttons before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft(version);
                save(version);
              }}
              data-testid={`button-version-suggestion-${version}`}
            >
              {version}
            </Button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Detected from release names when a download finishes. Updates that are not newer than this
        version are not notified.
      </p>
    </div>
  );
}
