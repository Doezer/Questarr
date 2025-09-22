import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, Star, Calendar } from "lucide-react";
import { useState } from "react";
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';
import scifiShooterCover from '@assets/generated_images/Sci-fi_shooter_game_cover_44a05942.png';
import racingCover from '@assets/generated_images/Racing_game_cover_art_7a256a20.png';
import puzzleCover from '@assets/generated_images/Indie_puzzle_game_cover_d884c5f4.png';

export default function Discovery() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("trending");

  //todo: remove mock functionality
  const discoveryGames: Game[] = [
    {
      id: "disc1",
      title: "Elder Scrolls: Legendary Edition",
      coverImage: fantasyRpgCover,
      status: "wishlist",
      platforms: ["PC", "PlayStation"],
      genre: "Action RPG",
      releaseDate: "2024-03-15",
      rating: 9.2
    },
    {
      id: "disc2",
      title: "Cyber Assault: Future Wars",
      coverImage: scifiShooterCover,
      status: "wishlist",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      releaseDate: "2024-06-20",
      rating: 8.5
    },
    {
      id: "disc3",
      title: "Neon Speed Racing",
      coverImage: racingCover,
      status: "wishlist",
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Racing",
      releaseDate: "2024-01-10",
      rating: 7.8
    },
    {
      id: "disc4",
      title: "Pixel Adventure Quest",
      coverImage: puzzleCover,
      status: "wishlist",
      platforms: ["PC", "Switch", "Mobile"],
      genre: "Puzzle Platformer",
      releaseDate: "2023-11-05",
      rating: 8.9
    }
  ];

  //todo: remove mock functionality
  const trendingGenres = [
    { name: "Action RPG", count: 42 },
    { name: "FPS", count: 28 },
    { name: "Racing", count: 15 },
    { name: "Puzzle", count: 31 }
  ];

  const tabs = [
    { id: "trending", label: "Trending", icon: TrendingUp },
    { id: "new", label: "New Releases", icon: Star },
    { id: "upcoming", label: "Coming Soon", icon: Calendar }
  ];

  const handleSearch = () => {
    console.log(`Searching for: ${searchQuery}`);
  };

  const handleStatusChange = (gameId: string, status: string) => {
    console.log(`Status changed for game ${gameId} to ${status}`);
  };

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on discovery game: ${game.title}`);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-discovery-title">Discovery</h1>
        <p className="text-muted-foreground">Explore and discover new games to add to your collection</p>
      </div>

      {/* Search Bar */}
      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-discovery-search"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} data-testid="button-search">
          Search
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab(tab.id)}
                  className="gap-2"
                  data-testid={`button-tab-${tab.id}`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              );
            })}
          </div>

          {/* Games Grid */}
          <GameGrid
            games={discoveryGames}
            title={`${tabs.find(t => t.id === activeTab)?.label} Games`}
            onGameClick={handleGameClick}
            onStatusChange={handleStatusChange}
            showFilters={true}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Trending Genres */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Trending Genres
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {trendingGenres.map((genre) => (
                <div key={genre.name} className="flex items-center justify-between">
                  <span className="text-sm">{genre.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {genre.count}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Star className="h-4 w-4 mr-2" />
                Browse Top Rated
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Calendar className="h-4 w-4 mr-2" />
                View Release Calendar
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <TrendingUp className="h-4 w-4 mr-2" />
                Popular This Week
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}