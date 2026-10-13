import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type CollectionRules, type Game } from "@shared/schema";
import { gameMatchesCollectionRules } from "@shared/collection-rules";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CollectionDto } from "@/lib/collections";
import { getStatusLabel } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

interface CollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The collection to edit; omit to create a new one. */
  collection?: CollectionDto | undefined;
  onSaved?: ((collection: CollectionDto) => void) | undefined;
}

function toNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptions(values: string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function CollectionDialog({
  open,
  onOpenChange,
  collection,
  onSaved,
}: Readonly<CollectionDialogProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!collection;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"manual" | "smart">("manual");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [minRating, setMinRating] = useState("");
  const [minUserRating, setMinUserRating] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [titleContains, setTitleContains] = useState("");

  // Reset the form each time the dialog opens, from the collection being edited if any.
  useEffect(() => {
    if (!open) return;
    const rules = collection?.rules ?? {};
    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
    setType(collection?.type ?? "manual");
    setStatuses(rules.statuses ?? []);
    setGenres(rules.genres ?? []);
    setPlatforms(rules.platforms ?? []);
    setMinRating(rules.minRating?.toString() ?? "");
    setMinUserRating(rules.minUserRating?.toString() ?? "");
    setYearFrom(rules.releaseYearFrom?.toString() ?? "");
    setYearTo(rules.releaseYearTo?.toString() ?? "");
    setTitleContains(rules.titleContains ?? "");
  }, [open, collection]);

  const { data: games = [] } = useQuery<Game[]>({ queryKey: ["/api/games"], enabled: open });

  const { genreOptions, platformOptions } = useMemo(() => {
    const genreSet = new Set<string>(genres);
    const platformSet = new Set<string>(platforms);
    for (const game of games) {
      game.genres?.forEach((g) => genreSet.add(g));
      game.platforms?.forEach((p) => platformSet.add(p));
    }
    const sorted = (set: Set<string>) =>
      toOptions(Array.from(set).sort((a, b) => a.localeCompare(b)));
    return { genreOptions: sorted(genreSet), platformOptions: sorted(platformSet) };
  }, [games, genres, platforms]);

  const rules = useMemo<CollectionRules>(() => {
    const minRatingValue = toNumber(minRating);
    const minUserRatingValue = toNumber(minUserRating);
    const yearFromValue = toNumber(yearFrom);
    const yearToValue = toNumber(yearTo);
    const title = titleContains.trim();
    return {
      ...(statuses.length > 0 && { statuses }),
      ...(genres.length > 0 && { genres }),
      ...(platforms.length > 0 && { platforms }),
      ...(minRatingValue !== undefined && { minRating: minRatingValue }),
      ...(minUserRatingValue !== undefined && { minUserRating: minUserRatingValue }),
      ...(yearFromValue !== undefined && { releaseYearFrom: yearFromValue }),
      ...(yearToValue !== undefined && { releaseYearTo: yearToValue }),
      ...(title !== "" && { titleContains: title }),
    };
  }, [statuses, genres, platforms, minRating, minUserRating, yearFrom, yearTo, titleContains]);

  const hasRules = Object.keys(rules).length > 0;
  const matchCount = useMemo(
    () => (hasRules ? games.filter((g) => gameMatchesCollectionRules(g, rules)).length : 0),
    [games, rules, hasRules]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description: description.trim() || null,
        type,
        ...(type === "smart" && { rules }),
      };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/collections/${collection.id}`, body)
        : await apiRequest("POST", "/api/collections", body);
      return (await res.json()) as CollectionDto;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      toast({ title: isEdit ? "Collection updated" : "Collection created" });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save the collection",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canSave = name.trim() !== "" && (type === "manual" || hasRules) && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>
            Group games yourself, or let Questarr fill the collection from rules.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) saveMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cozy games, Co-op night…"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-description">Description (optional)</Label>
            <Textarea
              id="collection-description"
              value={description}
              maxLength={500}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label id="collection-type-label">Type</Label>
            <RadioGroup
              aria-labelledby="collection-type-label"
              value={type}
              onValueChange={(value) => setType(value as "manual" | "smart")}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Label
                htmlFor="collection-type-manual"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="collection-type-manual" value="manual" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Manual</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    You pick the games.
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="collection-type-smart"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="collection-type-smart" value="smart" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Smart</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Games that match rules, kept up to date.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          </div>

          {type === "smart" && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Rules</legend>
              <p className="text-xs text-muted-foreground">
                A game must match every rule you set. Within a list, any one value is enough.
              </p>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <MultiSelect
                  aria-label="Status rule"
                  options={GAME_STATUSES.map((s) => ({ label: getStatusLabel(s), value: s }))}
                  selected={statuses}
                  onChange={setStatuses}
                  placeholder="Any status"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Genre</Label>
                <MultiSelect
                  aria-label="Genre rule"
                  options={genreOptions}
                  selected={genres}
                  onChange={setGenres}
                  placeholder="Any genre"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <MultiSelect
                  aria-label="Platform rule"
                  options={platformOptions}
                  selected={platforms}
                  onChange={setPlatforms}
                  placeholder="Any platform"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="collection-min-rating">Min. IGDB rating (0-10)</Label>
                  <Input
                    id="collection-min-rating"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step={0.5}
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="collection-min-user-rating">Min. my rating (0.5-10)</Label>
                  <Input
                    id="collection-min-user-rating"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step={0.5}
                    value={minUserRating}
                    onChange={(e) => setMinUserRating(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="collection-year-from">Released from (year)</Label>
                  <Input
                    id="collection-year-from"
                    type="number"
                    inputMode="numeric"
                    min={1950}
                    max={2100}
                    value={yearFrom}
                    onChange={(e) => setYearFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="collection-year-to">Released until (year)</Label>
                  <Input
                    id="collection-year-to"
                    type="number"
                    inputMode="numeric"
                    min={1950}
                    max={2100}
                    value={yearTo}
                    onChange={(e) => setYearTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="collection-title-contains">Title contains</Label>
                <Input
                  id="collection-title-contains"
                  value={titleContains}
                  maxLength={100}
                  onChange={(e) => setTitleContains(e.target.value)}
                />
              </div>

              <p className="text-sm text-muted-foreground" aria-live="polite">
                {hasRules
                  ? `${matchCount} ${matchCount === 1 ? "game matches" : "games match"} right now.`
                  : "Set at least one rule."}
              </p>
            </fieldset>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
