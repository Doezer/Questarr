import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Clock, Star, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { gameAPI } from "@/lib/api";
import { calculateDaysUntil, formatDate } from "@/lib/gameUtils";
import { useMemo } from "react";

export default function Calendar() {
  const { data: allGames = [], isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: gameAPI.getAll,
  });

  // Get upcoming games (all games with future release dates)
  const upcomingGames = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return allGames
      .filter(game => game.releaseDate && game.releaseDate > today)
      .sort((a, b) => new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime())
      .map(game => ({
        id: game.id,
        title: game.title,
        date: formatDate(game.releaseDate),
        status: game.status,
        platforms: game.platforms,
        genre: game.genre,
        daysUntil: calculateDaysUntil(game.releaseDate)
      }));
  }, [allGames]);

  // Group releases by month for the overview
  const monthlyReleases = useMemo(() => {
    const grouped = upcomingGames.reduce((acc, game) => {
      const date = new Date(game.date);
      if (isNaN(date.getTime())) return acc;
      
      const monthKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      acc[monthKey] = (acc[monthKey] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get next 4 months
    return Object.entries(grouped)
      .slice(0, 4)
      .reduce((acc, [month, count]) => {
        acc[month] = count;
        return acc;
      }, {} as Record<string, number>);
  }, [upcomingGames]);

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium">Failed to load calendar</h3>
          <p className="text-muted-foreground">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

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
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-lg border">
                    <div className="flex-shrink-0 w-12 h-16 bg-muted rounded"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4"></div>
                      <div className="h-3 bg-muted rounded w-1/2"></div>
                      <div className="h-3 bg-muted rounded w-2/3"></div>
                    </div>
                  </div>
                ))
              ) : upcomingGames.length > 0 ? (
                upcomingGames.map((game) => (
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
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No upcoming releases found
                </div>
              )}
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
                <div className="text-2xl font-bold">{upcomingGames.length}</div>
                <p className="text-xs text-muted-foreground">Upcoming releases</p>
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
              {upcomingGames.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium text-sm">{upcomingGames[0].title}</p>
                  <p className="text-xs text-muted-foreground">Releasing in {upcomingGames[0].daysUntil} days</p>
                  <div className="flex gap-1 flex-wrap">
                    {upcomingGames[0].platforms.map(platform => (
                      <Badge key={platform} variant="outline" className="text-xs">{platform}</Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No upcoming releases</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}