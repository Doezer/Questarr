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
  /** Where the version came from: typed by the user, a release name, or the install files. */
  readonly installedVersionSource?: string | null;
  /** Release names of the game's downloads, mined for version suggestions. */
  readonly releaseNames: readonly string[];
}

const MAX_SUGGESTIONS = 6;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Set by you",
  release: "From the downloaded release name",
  install: "Read from the install files",
};

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
  installedVersionSource = null,
  releaseNames,
}: InstalledVersionFieldProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(installedVersion ?? "");
  // A value entered while a save is in flight; sent once that save settles, so saves never
  // race and the latest value always lands last.
  const queued = useRef<{ value: string | null } | null>(null);

  // The server value the draft last followed, and for which game.
  const synced = useRef({ gameId, value: installedVersion ?? "" });

  // Follow the server value (another tab, a finished download detecting a newer version),
  // unless the user has edited the draft since: a refetch must not wipe what they are typing.
  useEffect(() => {
    const next = installedVersion ?? "";
    const previous = synced.current;
    synced.current = { gameId, value: next };
    setDraft((draft) => (previous.gameId !== gameId || draft === previous.value ? next : draft));
  }, [gameId, installedVersion]);

  const mutation = useMutation<void, Error, string | null>({
    mutationFn: async (value) => {
      await apiRequest("PATCH", `/api/games/${gameId}/installed-version`, {
        installedVersion: value,
      });
    },
    // Stays pending until the games refetch lands: until then `installedVersion` is stale, and
    // typing the old value back must still count as a change.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/games"] }),
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

  const save = (value: string, confirm = false) => {
    const next = value.trim() || null;
    // Checked before comparing with the stored value, which is stale while a save is in
    // flight: going back to it then still needs a save to undo the in-flight one.
    if (mutation.isPending) {
      // Enter then blur would otherwise send the same value twice before the refetch lands.
      queued.current = mutation.variables === next ? null : { value: next };
      return;
    }
    // Pressing Enter on the unchanged detected version confirms it as the user's own, so it is
    // no longer replaced by detection; leaving the field untouched does not.
    const confirmsDetected =
      confirm && !!next && !!installedVersionSource && installedVersionSource !== "manual";
    if (next === (installedVersion ?? null) && !confirmsDetected) return;
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
              // Enter confirming an IME candidate is not a submit.
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              save(draft, true);
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
      {installedVersion && (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="text-installed-version-source"
        >
          Source: {SOURCE_LABELS[installedVersionSource ?? "manual"] ?? "Set by you"}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Detected from the install files or from release names when a download finishes. A version
        you type is never replaced by the install files and only moves forward when a download is
        newer. Updates that are not newer than this version are not notified.
      </p>
    </div>
  );
}
