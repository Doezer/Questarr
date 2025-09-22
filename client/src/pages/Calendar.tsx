import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Clock, Star } from "lucide-react";

export default function Calendar() {
  //todo: remove mock functionality
  const upcomingGames = [
    {
      id: 1,
      title: "Cyber Assault: Future Wars",
      date: "2024-06-20",
      status: "wishlist",
      platforms: ["PC", "Xbox"],
      genre: "FPS",
      daysUntil: 45
    },
    {
      id: 2,
      title: "Dragon's Legacy: Ultimate Edition", 
      date: "2024-08-15",
      status: "wishlist",
      platforms: ["PC", "PlayStation", "Xbox"],
      genre: "Action RPG",
      daysUntil: 101
    },
    {
      id: 3,
      title: "Puzzle Masters Collection",
      date: "2024-09-05",
      status: "wishlist", 
      platforms: ["PC", "Switch", "Mobile"],
      genre: "Puzzle",
      daysUntil: 122
    },
    {
      id: 4,
      title: "Space Explorer: Infinite Journey",
      date: "2024-10-12",
      status: "owned",
      platforms: ["PC", "PlayStation"],
      genre: "Exploration",
      daysUntil: 159
    }
  ];

  //todo: remove mock functionality
  const monthlyReleases = {
    "June 2024": 3,
    "July 2024": 5,
    "August 2024": 2,
    "September 2024": 4
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "wishlist": return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "owned": return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      default: return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-calendar-title">Release Calendar</h1>
        <p className="text-muted-foreground">Upcoming game releases you're tracking</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                Upcoming Releases
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingGames.map((game, index) => (
                <div key={game.id} className="group">
                  <div className="flex items-start gap-4 p-4 rounded-lg hover-elevate border">
                    <div className="flex-shrink-0 w-12 h-16 bg-muted rounded flex items-center justify-center">
                      <span className="text-xs font-mono">IMG</span>
                    </div>
                    
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-sm leading-tight">{game.title}</h3>
                          <p className="text-xs text-muted-foreground">{game.genre}</p>
                        </div>
                        <Badge variant="outline" className={getStatusColor(game.status)}>
                          {game.status}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {game.date}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {game.daysUntil} days
                        </div>
                      </div>
                      
                      <div className="flex gap-1 flex-wrap">
                        {game.platforms.map(platform => (
                          <Badge key={platform} variant="outline" className="text-xs">
                            {platform}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Monthly Overview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Release Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold">12</div>
                <p className="text-xs text-muted-foreground">Games this quarter</p>
              </div>
              
              <div className="space-y-3">
                {Object.entries(monthlyReleases).map(([month, count]) => (
                  <div key={month} className="flex items-center justify-between">
                    <span className="text-sm">{month}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Star className="h-4 w-4" />
                Most Anticipated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="font-medium text-sm">Cyber Assault: Future Wars</p>
                <p className="text-xs text-muted-foreground">Releasing in 45 days</p>
                <div className="flex gap-1 flex-wrap">
                  <Badge variant="outline" className="text-xs">PC</Badge>
                  <Badge variant="outline" className="text-xs">Xbox</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}