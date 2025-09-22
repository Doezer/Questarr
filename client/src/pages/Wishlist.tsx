import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, TrendingUp } from "lucide-react";
import scifiShooterCover from '@assets/generated_images/Sci-fi_shooter_game_cover_44a05942.png';
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';

export default function Wishlist() {
  //todo: remove mock functionality
  const wishlistedGames: Game[] = [
    {
      id: "wish1",
      title: "Cyber Assault: Future Wars",
      coverImage: scifiShooterCover,
      status: "wishlist",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      releaseDate: "2024-06-20",
      rating: 8.5
    },
    {
      id: "wish2",
      title: "Dragon's Legacy: Ultimate Edition",
      coverImage: fantasyRpgCover,
      status: "wishlist", 
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Action RPG",
      releaseDate: "2024-08-15",
      rating: 9.0
    }
  ];

  //todo: remove mock functionality
  const upcomingReleases = [
    { title: "Cyber Assault: Future Wars", date: "2024-06-20", daysUntil: 45 },
    { title: "Dragon's Legacy: Ultimate Edition", date: "2024-08-15", daysUntil: 101 }
  ];

  const handleStatusChange = (gameId: string, status: string) => {
    console.log(`Status changed for game ${gameId} to ${status}`);
  };

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on wishlist game: ${game.title}`);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-wishlist-title">Wishlist</h1>
        <p className="text-muted-foreground">Games you're tracking for release</p>
      </div>

      {/* Wishlist Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Wishlisted</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-wishlist-total">8</div>
            <p className="text-xs text-muted-foreground">3 releasing soon</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-wishlist-month">2</div>
            <p className="text-xs text-muted-foreground">Games releasing</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Next Release</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">Cyber Assault</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">45 days</Badge>
              <span className="text-xs text-muted-foreground">Jun 20, 2024</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Wishlist Games */}
        <div className="lg:col-span-2">
          <GameGrid
            games={wishlistedGames}
            title="Your Wishlist"
            onGameClick={handleGameClick}
            onStatusChange={handleStatusChange}
            showFilters={true}
          />
        </div>

        {/* Release Timeline */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Release Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingReleases.map((release, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-sm leading-tight">{release.title}</p>
                      <p className="text-xs text-muted-foreground">{release.date}</p>
                    </div>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {release.daysUntil} days
                    </Badge>
                  </div>
                  {index < upcomingReleases.length - 1 && (
                    <div className="border-l-2 border-muted h-4 ml-2"></div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}