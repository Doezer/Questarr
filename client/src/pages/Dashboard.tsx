import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { TrendingUp, Library, Heart, Calendar, Clock } from "lucide-react";
import fantasyRpgCover from '@assets/generated_images/Fantasy_RPG_game_cover_53d6bedb.png';
import scifiShooterCover from '@assets/generated_images/Sci-fi_shooter_game_cover_44a05942.png';
import racingCover from '@assets/generated_images/Racing_game_cover_art_7a256a20.png';

export default function Dashboard() {
  //todo: remove mock functionality
  const recentlyAdded: Game[] = [
    {
      id: "recent1",
      title: "Elder Scrolls: Legendary Edition",
      coverImage: fantasyRpgCover,
      status: "owned",
      platforms: ["PC", "PlayStation"],
      genre: "Action RPG",
      releaseDate: "2024-03-15",
      rating: 9.2
    },
    {
      id: "recent2",
      title: "Cyber Assault: Future Wars", 
      coverImage: scifiShooterCover,
      status: "wishlist",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      releaseDate: "2024-06-20",
      rating: 8.5
    },
    {
      id: "recent3",
      title: "Neon Speed Racing",
      coverImage: racingCover,
      status: "playing",
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Racing",
      releaseDate: "2024-01-10", 
      rating: 7.8
    }
  ];

  //todo: remove mock functionality
  const upcomingReleases = [
    { title: "Fantasy Quest VII", date: "2024-05-15", status: "wishlist" },
    { title: "Space Combat Elite", date: "2024-06-20", status: "wishlist" },
    { title: "Racing Legends 2024", date: "2024-07-08", status: "owned" }
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your game collection and activity</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Games</CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-total">42</div>
            <p className="text-xs text-muted-foreground">+3 from last month</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wishlist</CardTitle>
            <Heart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-wishlist">8</div>
            <p className="text-xs text-muted-foreground">2 releasing this month</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Currently Playing</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-playing">3</div>
            <p className="text-xs text-muted-foreground">Average: 2.5 games</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-month">5</div>
            <p className="text-xs text-muted-foreground">Games added</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recently Added */}
        <div className="lg:col-span-2">
          <GameGrid 
            games={recentlyAdded} 
            title="Recently Added"
            showFilters={false}
          />
        </div>

        {/* Upcoming Releases */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Upcoming Releases
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingReleases.map((release, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{release.title}</p>
                    <p className="text-xs text-muted-foreground">{release.date}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {release.status}
                  </Badge>
                </div>
              ))}
              <div className="text-center pt-2">
                <Badge variant="secondary" className="text-xs">
                  View All Upcoming
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}