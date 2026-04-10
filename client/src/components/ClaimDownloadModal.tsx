import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Link2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import { categorizeDownload, type DownloadCategory } from "@shared/download-categorizer";
import { releaseMatchesGame } from "@shared/title-utils";
import { apiRequest } from "@/lib/queryClient";

interface ClaimDownload {
  id: string;
  name: string;
  status: string;
  downloadType?: "torrent" | "usenet";
  downloaderId: string;
  downloaderName: string;
}

interface ClaimDownloadModalProps {
  download: ClaimDownload;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface IgdbSearchResult extends Game {
  inCollection?: boolean;
}

export default function ClaimDownloadModal({
  download,
  open,
  onOpenChange,
}: ClaimDownloadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detected = categorizeDownload(download.name);
  const [category, setCategory] = useState<DownloadCategory>(detected.category);
  const [librarySearch, setLibrarySearch] = useState("");
  const [igdbQuery, setIgdbQuery] = useState("");
  const [debouncedIgdbQuery, setDebouncedIgdbQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<{
    id: string;
    title: string;
    coverUrl?: string;
    source: "library" | "igdb";
    data: Game;
  } | null>(null);

  // Reset when download changes
  useEffect(() => {
    if (open) {
      const d = categorizeDownload(download.name);
      setCategory(d.category);
      setLibrarySearch("");
      setIgdbQuery("");
      setDebouncedIgdbQuery("");
      setSelectedGame(null);
    }
  }, [open, download.name]);

  // Debounce IGDB query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedIgdbQuery(igdbQuery), 500);
    return () => clearTimeout(t);
  }, [igdbQuery]);

  // User's library
  const { data: userGames = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  // Library matches: releaseMatchesGame first, then fall back to text filter
  const libraryMatches = userGames.filter((g) => {
    if (librarySearch.trim()) {
      return g.title.toLowerCase().includes(librarySearch.toLowerCase());
    }
    return releaseMatchesGame(download.name, g.title);
  });

  // IGDB search
  const { data: igdbResults = [], isLoading: isSearchingIgdb } = useQuery<IgdbSearchResult[]>({
    queryKey: ["/api/igdb/search", debouncedIgdbQuery],
    queryFn: async () => {
      if (!debouncedIgdbQuery.trim()) return [];
      const res = await apiRequest(
        "GET",
        `/api/igdb/search?q=${encodeURIComponent(debouncedIgdbQuery)}&limit=10`
      );
      return res.json();
    },
    enabled: debouncedIgdbQuery.trim().length > 2,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGame) throw new Error("No game selected");

      const body: Record<string, unknown> = {
        downloaderId: download.downloaderId,
        downloadHash: download.id,
        downloadTitle: download.name,
        currentStatus: download.status,
        category,
      };

      if (selectedGame.source === "library") {
        body.gameId = selectedGame.id;
      } else {
        const g = selectedGame.data;
        body.newGame = {
          igdbId: g.igdbId,
          title: g.title,
          coverUrl: g.coverUrl,
          summary: g.summary,
          releaseDate: g.releaseDate,
          platforms: g.platforms,
          genres: g.genres,
          rating: g.rating,
          aggregatedRating: g.aggregatedRating,
          screenshots: g.screenshots,
          igdbWebsites: g.igdbWebsites,
          source: "api",
        };
      }

      const res = await apiRequest("POST", "/api/downloads/claim", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Download linked to game" });
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Failed to link download", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Link to Game</DialogTitle>
          <DialogDescription className="truncate">{download.name}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Category:</span>
          <Select value={category} onValueChange={(v) => setCategory(v as DownloadCategory)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="main">Main</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="dlc">DLC</SelectItem>
              <SelectItem value="extra">Extra</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-xs">
            {Math.round(detected.confidence * 100)}% confidence
          </Badge>
        </div>

        <Tabs defaultValue="library" className="flex-1 flex flex-col min-h-0">
          <TabsList>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="igdb">IGDB Search</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search your library…"
                className="pl-8"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
            </div>
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {libraryMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {librarySearch
                    ? "No games match your search"
                    : "No library matches found — try IGDB Search"}
                </p>
              ) : (
                libraryMatches.map((g) => (
                  <GameRow
                    key={g.id}
                    game={g}
                    selected={selectedGame?.id === g.id && selectedGame?.source === "library"}
                    onSelect={() =>
                      setSelectedGame({
                        id: g.id,
                        title: g.title,
                        coverUrl: g.coverUrl ?? undefined,
                        source: "library",
                        data: g,
                      })
                    }
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="igdb" className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search IGDB…"
                className="pl-8"
                value={igdbQuery}
                onChange={(e) => setIgdbQuery(e.target.value)}
              />
            </div>
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {isSearchingIgdb ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Searching…</p>
              ) : igdbResults.length === 0 && debouncedIgdbQuery ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No results found</p>
              ) : (
                igdbResults.map((g) => (
                  <GameRow
                    key={g.igdbId ?? g.id}
                    game={g}
                    selected={
                      selectedGame?.source === "igdb" && selectedGame?.data.igdbId === g.igdbId
                    }
                    onSelect={() =>
                      setSelectedGame({
                        id: g.igdbId?.toString() ?? g.id,
                        title: g.title,
                        coverUrl: g.coverUrl ?? undefined,
                        source: "igdb",
                        data: g,
                      })
                    }
                  />
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        {selectedGame && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-muted text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="truncate font-medium">{selectedGame.title}</span>
            <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
              {selectedGame.source === "library" ? "Library" : "IGDB"}
            </Badge>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => claimMutation.mutate()}
            disabled={!selectedGame || claimMutation.isPending}
          >
            <Link2 className="h-4 w-4 mr-2" />
            {claimMutation.isPending ? "Linking…" : "Link Download"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GameRow({
  game,
  selected,
  onSelect,
}: {
  game: Game;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-2 rounded-md text-left hover:bg-accent transition-colors ${
        selected ? "bg-accent ring-1 ring-primary" : ""
      }`}
    >
      {game.coverUrl ? (
        <img
          src={game.coverUrl}
          alt={game.title}
          className="h-10 w-8 object-cover rounded shrink-0"
        />
      ) : (
        <div className="h-10 w-8 rounded bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{game.title}</p>
        {game.releaseDate && (
          <p className="text-xs text-muted-foreground">{game.releaseDate.substring(0, 4)}</p>
        )}
      </div>
      {selected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}
