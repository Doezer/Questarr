import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  TAGS_KEY,
  findTagByName,
  invalidateTagQueries,
  safeTagColor,
  type GameTagEntry,
  type Tag,
} from "@/lib/tags";

interface GameTagsFieldProps {
  readonly gameId: string;
}

function TagDot({ color }: { readonly color: string | null | undefined }) {
  const safe = safeTagColor(color);
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border bg-muted"
      style={safe ? { backgroundColor: safe } : undefined}
    />
  );
}

/** Add and remove the user's own tags on a game; typing a new name creates the tag. */
export default function GameTagsField({ gameId }: GameTagsFieldProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const { data: allTagsData, refetch: refetchTags } = useQuery<Tag[]>({
    queryKey: TAGS_KEY,
  });
  // A tag created by a failed create-then-attach, kept so a retry only attaches it.
  const createdTag = useRef<Tag | null>(null);
  const { data: gameTagsData } = useQuery<GameTagEntry[]>({
    queryKey: ["/api/games", gameId, "tags"],
  });
  // Without the list, "new" names cannot be told from existing ones.
  const tagsLoaded = Array.isArray(allTagsData);
  const allTags = Array.isArray(allTagsData) ? allTagsData : [];
  const gameTags = Array.isArray(gameTagsData) ? gameTagsData : [];

  const attachedIds = new Set(gameTags.map((entry) => entry.tagId));
  const suggestions = allTags.filter((tag) => !attachedIds.has(tag.id));

  const fail = (description: string) => () => toast({ description, variant: "destructive" });

  const attach = useMutation<void, Error, string>({
    mutationFn: async (tagId) => {
      await apiRequest("POST", `/api/games/${gameId}/tags`, { tagId });
    },
    onSuccess: () => invalidateTagQueries(queryClient),
    onError: fail("Could not add the tag"),
  });

  const create = useMutation<void, Error, string>({
    mutationFn: async (tagName) => {
      const res = await apiRequest("POST", "/api/tags", { name: tagName });
      const tag = (await res.json()) as Tag;
      createdTag.current = tag;
      await apiRequest("POST", `/api/games/${gameId}/tags`, { tagId: tag.id });
    },
    onSuccess: () => {
      createdTag.current = null;
      setName("");
    },
    // The tag exists even when attaching it failed, so a retry must find it instead of re-creating it.
    onSettled: () => invalidateTagQueries(queryClient),
    onError: fail("Could not create the tag"),
  });

  const detach = useMutation<void, Error, string>({
    mutationFn: async (tagId) => {
      await apiRequest("DELETE", `/api/games/${gameId}/tags/${tagId}`);
    },
    onSuccess: () => invalidateTagQueries(queryClient),
    onError: fail("Could not remove the tag"),
  });

  const busy = attach.isPending || create.isPending || detach.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!tagsLoaded) return;
    const retained = createdTag.current;
    const existing =
      findTagByName(allTags, trimmed) ??
      (retained && findTagByName([retained], trimmed) ? retained : undefined);
    if (!existing) {
      create.mutate(trimmed);
    } else if (attachedIds.has(existing.id)) {
      setName("");
    } else {
      attach.mutate(existing.id, {
        onSuccess: () => {
          createdTag.current = null;
          setName("");
        },
      });
    }
  };

  return (
    <div data-testid="section-game-tags">
      <label
        htmlFor={`game-tag-input-${gameId}`}
        className="font-semibold mb-2 flex items-center gap-2"
      >
        <TagIcon className="w-4 h-4" />
        Tags
      </label>

      {gameTags.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Tags on this game">
          {gameTags.map((entry) => (
            <li key={entry.id}>
              <Badge
                variant="secondary"
                className="gap-1.5 pr-1"
                data-testid={`game-tag-${entry.tagId}`}
              >
                <TagDot color={entry.tag?.color} />
                <span className="max-w-[12rem] truncate">{entry.tag?.name ?? "Tag"}</span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove tag ${entry.tag?.name ?? ""}`.trim()}
                  disabled={busy}
                  onClick={() => detach.mutate(entry.tagId)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">No tags yet.</p>
      )}

      <form className="flex max-w-sm gap-2" onSubmit={submit}>
        <Input
          id={`game-tag-input-${gameId}`}
          value={name}
          maxLength={100}
          placeholder="Add a tag"
          className="h-10 sm:h-9"
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          className="h-10 sm:h-9"
          disabled={busy || !tagsLoaded || !name.trim()}
          aria-label="Add tag"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </form>

      {!tagsLoaded && (
        <p className="mt-2 text-xs text-muted-foreground">
          Tags are not loaded yet.{" "}
          <button type="button" className="underline" onClick={() => void refetchTags()}>
            Retry
          </button>
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Existing tags">
          {suggestions.map((tag) => (
            <Button
              key={tag.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={busy}
              onClick={() => attach.mutate(tag.id)}
            >
              <TagDot color={tag.color} />
              {tag.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
