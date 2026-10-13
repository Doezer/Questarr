import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, Layers, ListPlus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useGameStatusMutation } from "@/hooks/use-game-status-mutation";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useDownloadSummary } from "@/hooks/use-download-summary";
import { useGridColumns } from "@/hooks/use-grid-columns";
import { apiRequest } from "@/lib/queryClient";
import { routePaths } from "@/lib/routes";
import type { Game } from "@shared/schema";
import { describeRules, type CollectionDetail, type CollectionSummary } from "@/lib/collections";
import { useToast } from "@/hooks/use-toast";
import CollectionDialog from "@/components/CollectionDialog";
import CollectionGamesDialog from "@/components/CollectionGamesDialog";
import EmptyState from "@/components/EmptyState";
import GameStatusGrid from "@/components/GameStatusGrid";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";

function TypeBadge({ type }: Readonly<{ type: "manual" | "smart" }>) {
  return type === "smart" ? (
    <Badge variant="secondary" className="gap-1">
      <Sparkles className="h-3 w-3" aria-hidden="true" /> Smart
    </Badge>
  ) : (
    <Badge variant="outline">Manual</Badge>
  );
}

function CoverMosaic({ urls }: Readonly<{ urls: string[] }>) {
  return (
    <div className="flex aspect-[16/9] gap-px overflow-hidden bg-muted" aria-hidden="true">
      {urls.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Layers className="h-8 w-8" />
        </div>
      ) : (
        urls.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            loading="lazy"
            className="h-full min-w-0 flex-1 object-cover"
          />
        ))
      )}
    </div>
  );
}

/**
 * Collections are derived from the games, but game mutations and the gameUpdated socket event only
 * invalidate the games query. Re-fetch the collections whenever that query refreshes.
 */
function useRefreshCollectionsOnGameChange() {
  const queryClient = useQueryClient();
  const { dataUpdatedAt } = useQuery<Game[]>({ queryKey: ["/api/games"] });
  const seen = useRef(dataUpdatedAt);
  useEffect(() => {
    if (seen.current === dataUpdatedAt) return;
    seen.current = dataUpdatedAt;
    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
  }, [dataUpdatedAt, queryClient]);
}

function collectionUrl(id: string): string {
  return `${routePaths.collections}?id=${encodeURIComponent(id)}`;
}

function CollectionList() {
  useRefreshCollectionsOnGameChange();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: collections = [], isLoading } = useQuery<CollectionSummary[]>({
    queryKey: ["/api/collections"],
  });

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <PageHeader
        title="Collections"
        description="Group your games by hand, or let rules keep a collection up to date."
        actions={
          <Button className="h-10 justify-center sm:h-9" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New collection
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No collections yet"
          description="Create a collection to group games, such as “Co-op night” or every highly rated RPG."
          actionLabel="New collection"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link
                href={collectionUrl(collection.id)}
                className="block overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`collection-card-${collection.id}`}
              >
                <CoverMosaic urls={collection.coverUrls} />
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate font-semibold">{collection.name}</h2>
                    <TypeBadge type={collection.type} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {collection.gameCount} {collection.gameCount === 1 ? "game" : "games"}
                  </p>
                  {collection.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {collection.description}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(saved) => navigate(collectionUrl(saved.id))}
      />
    </div>
  );
}

function CollectionView({ id }: Readonly<{ id: string }>) {
  useRefreshCollectionsOnGameChange();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const downloadSummaries = useDownloadSummary();
  const { gridColumns } = useGridColumns("collectionGridColumns");
  const statusMutation = useGameStatusMutation();
  const hiddenMutation = useHiddenMutation({
    hiddenSuccessMessage: "Game hidden",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to update game visibility",
  });

  const {
    data: collection,
    isLoading,
    isError,
  } = useQuery<CollectionDetail>({ queryKey: ["/api/collections", id] });

  const memberIds = useMemo(
    () => new Set(collection?.games.map((game) => game.id) ?? []),
    [collection]
  );

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/collections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      toast({ title: "Collection deleted" });
      navigate(routePaths.collections);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not delete the collection",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const backLink = (
    <Link
      href={routePaths.collections}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All collections
    </Link>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-4 md:p-6">
        {backLink}
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  if (isError || !collection) {
    return (
      <div className="h-full overflow-auto p-4 md:p-6">
        {backLink}
        <EmptyState
          icon={Layers}
          title="Collection not found"
          description="It may have been deleted."
          actionLabel="Back to collections"
          actionLink={routePaths.collections}
        />
      </div>
    );
  }

  const isSmart = collection.type === "smart";

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      {backLink}
      <PageHeader
        title={collection.name}
        description={
          collection.description ??
          (isSmart ? describeRules(collection.rules) : `${collection.games.length} games`)
        }
        actions={
          <>
            {!isSmart && (
              <Button
                variant="outline"
                className="h-10 justify-center sm:h-9"
                onClick={() => setGamesOpen(true)}
              >
                <ListPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Manage games
              </Button>
            )}
            <Button
              variant="outline"
              className="h-10 justify-center sm:h-9"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Edit
            </Button>
            <Button
              variant="outline"
              className="h-10 justify-center text-destructive sm:h-9"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Delete
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TypeBadge type={collection.type} />
        <span className="text-sm text-muted-foreground">
          {collection.games.length} {collection.games.length === 1 ? "game" : "games"}
        </span>
        {isSmart && collection.description && (
          <span className="text-sm text-muted-foreground">· {describeRules(collection.rules)}</span>
        )}
      </div>

      {collection.games.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No games in this collection"
          description={
            isSmart
              ? "No game in your library matches these rules yet. Edit the collection to adjust them."
              : "Add games from your library to fill this collection."
          }
          {...(isSmart
            ? { actionLabel: "Edit rules", onAction: () => setEditOpen(true) }
            : { actionLabel: "Add games", onAction: () => setGamesOpen(true) })}
        />
      ) : (
        <GameStatusGrid
          games={collection.games}
          statusMutation={statusMutation}
          hiddenMutation={hiddenMutation}
          isLoading={false}
          viewMode="grid"
          density="comfortable"
          downloadSummaries={downloadSummaries}
          columns={gridColumns}
        />
      )}

      <CollectionDialog open={editOpen} onOpenChange={setEditOpen} collection={collection} />
      {!isSmart && (
        <CollectionGamesDialog
          open={gamesOpen}
          onOpenChange={setGamesOpen}
          collectionId={collection.id}
          collectionName={collection.name}
          memberIds={memberIds}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{collection.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the collection is removed. The games stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function CollectionsPage() {
  const search = useSearch();
  const id = new URLSearchParams(search).get("id");
  return id ? <CollectionView id={id} /> : <CollectionList />;
}
