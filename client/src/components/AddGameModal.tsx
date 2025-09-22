import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Plus, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";

interface SearchResult extends Game {
  inCollection?: boolean;
}

interface AddGameModalProps {
  children: React.ReactNode;
}

export default function AddGameModal({ children }: AddGameModalProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search IGDB for games
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['/api/igdb/search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const response = await fetch(`/api/igdb/search?q=${encodeURIComponent(debouncedQuery)}&limit=10`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: debouncedQuery.trim().length > 2
  });

  // Get user's collection to check if games are already added
  const { data: userGames = [] } = useQuery<Game[]>({
    queryKey: ['/api/games']
  });

  // Add game mutation
  const addGameMutation = useMutation({
    mutationFn: async (game: Game) => {
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(game)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add game');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games'] });
      toast({ description: "Game added to collection successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search is handled by the debounced query
  };

  const handleAddGame = (game: Game) => {
    addGameMutation.mutate(game);
  };

  // Mark games already in collection
  const resultsWithCollectionStatus: SearchResult[] = searchResults.map((game: Game) => ({
    ...game,
    inCollection: userGames.some((userGame) => 
      userGame.igdbId === game.igdbId || userGame.title === game.title
    )
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Game to Collection</DialogTitle>
          <DialogDescription>
            Search for games to add to your collection
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              type="search"
              placeholder="Search for games..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-game-search"
            />
          </div>
          <Button type="submit" disabled={isSearching} data-testid="button-search-games">
            <Search className="w-4 h-4" />
          </Button>
        </form>

        <div className="space-y-4">
          {isSearching && (
            <div className="text-center py-8 text-muted-foreground">
              Searching games...
            </div>
          )}

          {!isSearching && debouncedQuery && resultsWithCollectionStatus.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No games found. Try a different search term.
            </div>
          )}

          {resultsWithCollectionStatus.map((game) => (
            <Card key={game.id} className="hover-elevate" data-testid={`search-result-${game.id}`}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <img
                    src={game.coverUrl || "/placeholder-game-cover.jpg"}
                    alt={`${game.title} cover`}
                    className="w-16 h-24 object-cover rounded-md flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold truncate" data-testid={`text-game-title-${game.id}`}>
                        {game.title}
                      </h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {game.rating && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Star className="w-3 h-3 text-accent" />
                            {game.rating}/10
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {game.summary && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {game.summary}
                      </p>
                    )}
                    
                    <div className="flex flex-wrap gap-1 mb-3">
                      {game.genres?.slice(0, 3).map((genre) => (
                        <Badge key={genre} variant="secondary" className="text-xs">
                          {genre}
                        </Badge>
                      ))}
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {game.platforms?.slice(0, 3).map((platform) => (
                          <Badge key={platform} variant="outline" className="text-xs">
                            {platform}
                          </Badge>
                        ))}
                      </div>
                      
                      {game.inCollection ? (
                        <Badge variant="default" className="text-xs">
                          In Collection
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleAddGame(game)}
                          disabled={addGameMutation.isPending}
                          data-testid={`button-add-${game.id}`}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}