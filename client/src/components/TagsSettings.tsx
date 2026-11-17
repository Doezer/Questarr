import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_TAG_COLOR,
  TAGS_KEY,
  findTagByName,
  invalidateTagQueries,
  safeTagColor,
  type Tag,
} from "@/lib/tags";

interface TagDraft {
  name: string;
  color: string;
}

function messageOf(error: Error, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Create, rename, recolor and delete the tags the user puts on games. */
export function TagsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery<Tag[]>({ queryKey: TAGS_KEY });
  const tagsLoaded = Array.isArray(data);
  const tags = Array.isArray(data) ? data : [];

  const [newTag, setNewTag] = useState<TagDraft>({ name: "", color: DEFAULT_TAG_COLOR });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TagDraft>({ name: "", color: DEFAULT_TAG_COLOR });
  const [toDelete, setToDelete] = useState<Tag | null>(null);

  const done = () => invalidateTagQueries(queryClient);
  const fail = (fallback: string) => (error: Error) =>
    toast({ description: messageOf(error, fallback), variant: "destructive" });

  const create = useMutation<void, Error, TagDraft>({
    mutationFn: async (value) => {
      await apiRequest("POST", "/api/tags", { name: value.name.trim(), color: value.color });
    },
    onSuccess: () => {
      setNewTag({ name: "", color: newTag.color });
      done();
    },
    onError: fail("Could not create the tag"),
  });

  const update = useMutation<void, Error, { id: string } & TagDraft>({
    mutationFn: async ({ id, name, color }) => {
      await apiRequest("PATCH", `/api/tags/${id}`, { name: name.trim(), color });
    },
    onSuccess: (_result, variables) => {
      // Another tag's editor may have been opened while this save was pending.
      setEditingId((current) => (current === variables.id ? null : current));
      done();
    },
    onError: fail("Could not save the tag"),
  });

  const remove = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiRequest("DELETE", `/api/tags/${id}`);
    },
    onSuccess: () => {
      setToDelete(null);
      done();
    },
    onError: fail("Could not delete the tag"),
  });

  const duplicate = (name: string, ignoreId?: string) => {
    const found = findTagByName(tags, name);
    return Boolean(name.trim()) && found !== undefined && found.id !== ignoreId;
  };

  const startEditing = (tag: Tag) => {
    setEditingId(tag.id);
    setDraft({ name: tag.name, color: safeTagColor(tag.color) ?? DEFAULT_TAG_COLOR });
  };

  const newNameTaken = duplicate(newTag.name);

  return (
    <Card id="tags-config">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-lg">
          <TagIcon className="h-5 w-5" />
          Tags
        </CardTitle>
        <CardDescription>
          Your own labels for games. Add them from a game's page and filter the library by tag.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (tagsLoaded && newTag.name.trim() && !newNameTaken) create.mutate(newTag);
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-tag-name">New tag</Label>
            <Input
              id="new-tag-name"
              value={newTag.name}
              maxLength={100}
              placeholder="Tag name"
              aria-invalid={newNameTaken}
              onChange={(event) => setNewTag({ ...newTag, name: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-tag-color">Color</Label>
            <Input
              id="new-tag-color"
              type="color"
              value={newTag.color}
              className="h-10 w-16 p-1"
              onChange={(event) => setNewTag({ ...newTag, color: event.target.value })}
            />
          </div>
          <Button
            type="submit"
            className="h-10"
            disabled={!tagsLoaded || !newTag.name.trim() || newNameTaken || create.isPending}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add tag
          </Button>
        </form>
        {!tagsLoaded && (
          <p className="text-sm text-muted-foreground">
            Your tags are not loaded yet, so new ones cannot be created.{" "}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Retry
            </button>
          </p>
        )}
        {newNameTaken && (
          <p role="alert" className="text-sm text-destructive">
            You already have a tag with this name.
          </p>
        )}

        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Your tags">
            {tags.map((tag) => (
              <li key={tag.id} className="flex flex-wrap items-center gap-2 p-3">
                {editingId === tag.id ? (
                  <form
                    className="flex flex-1 flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (draft.name.trim() && !duplicate(draft.name, tag.id)) {
                        update.mutate({ id: tag.id, ...draft });
                      }
                    }}
                  >
                    <Input
                      aria-label={`Name of tag ${tag.name}`}
                      value={draft.name}
                      maxLength={100}
                      className="min-w-[10rem] flex-1"
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                    <Input
                      aria-label={`Color of tag ${tag.name}`}
                      type="color"
                      value={draft.color}
                      className="h-10 w-16 p-1"
                      onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        !draft.name.trim() || duplicate(draft.name, tag.id) || update.isPending
                      }
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full border border-border bg-muted"
                      style={
                        safeTagColor(tag.color)
                          ? { backgroundColor: safeTagColor(tag.color) }
                          : undefined
                      }
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{tag.name}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10"
                      aria-label={`Edit tag ${tag.name}`}
                      onClick={() => startEditing(tag)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10"
                      aria-label={`Delete tag ${tag.name}`}
                      onClick={() => setToDelete(tag)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the tag “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from every game that has it. The games themselves are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)}>
              Delete tag
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
