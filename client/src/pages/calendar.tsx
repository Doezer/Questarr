import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Game } from "@shared/schema";
import { cn } from "@/lib/utils";

type ViewMode = "year" | "month" | "week";

interface GamesByDate {
  [date: string]: Game[];
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getMonthName(month: number): string {
  return new Date(2000, month, 1).toLocaleDateString("en-US", { month: "long" });
}

function getWeekDays(date: Date): Date[] {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is sunday
  const monday = new Date(date.setDate(diff));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function getDaysInMonth(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];
  
  // Add days from previous month to fill the week
  const firstDayOfWeek = firstDay.getDay();
  const daysToAdd = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  for (let i = daysToAdd; i > 0; i--) {
    const d = new Date(year, month, 1 - i);
    days.push(d);
  }
  
  // Add all days of current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  
  // Add days from next month to complete the week
  const lastDayOfWeek = lastDay.getDay();
  const daysToAddEnd = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
  for (let i = 1; i <= daysToAddEnd; i++) {
    days.push(new Date(year, month + 1, i));
  }
  
  return days;
}

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("year");
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  // Filter wanted games with release dates
  const wantedGames = useMemo(() => {
    return games.filter(g => g.status === "wanted" && g.releaseDate);
  }, [games]);

  // Group games by date
  const gamesByDate = useMemo(() => {
    const grouped: GamesByDate = {};
    wantedGames.forEach(game => {
      if (game.releaseDate) {
        const date = formatDate(new Date(game.releaseDate));
        if (!grouped[date]) {
          grouped[date] = [];
        }
        grouped[date].push(game);
      }
    });
    return grouped;
  }, [wantedGames]);

  const navigatePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "year") {
      newDate.setFullYear(currentDate.getFullYear() - 1);
    } else if (viewMode === "month") {
      newDate.setMonth(currentDate.getMonth() - 1);
    } else {
      newDate.setDate(currentDate.getDate() - 7);
    }
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "year") {
      newDate.setFullYear(currentDate.getFullYear() + 1);
    } else if (viewMode === "month") {
      newDate.setMonth(currentDate.getMonth() + 1);
    } else {
      newDate.setDate(currentDate.getDate() + 7);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getTitle = () => {
    if (viewMode === "year") return currentDate.getFullYear().toString();
    if (viewMode === "month") return `${getMonthName(currentDate.getMonth())} ${currentDate.getFullYear()}`;
    const weekDays = getWeekDays(new Date(currentDate));
    return `${formatDate(weekDays[0])} - ${formatDate(weekDays[6])}`;
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Release Calendar</h1>
          <p className="text-muted-foreground">Track upcoming game releases</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="icon" onClick={navigatePrevious}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-2xl font-semibold">{getTitle()}</h2>
        <Button variant="ghost" size="icon" onClick={navigateNext}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading calendar...</div>
      ) : wantedGames.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No games in your wishlist. Add games to track their release dates.
        </div>
      ) : (
        <>
          {viewMode === "year" && <YearView currentDate={currentDate} gamesByDate={gamesByDate} />}
          {viewMode === "month" && <MonthView currentDate={currentDate} gamesByDate={gamesByDate} />}
          {viewMode === "week" && <WeekView currentDate={currentDate} gamesByDate={gamesByDate} />}
        </>
      )}
    </div>
  );
}

function YearView({ currentDate, gamesByDate }: { currentDate: Date; gamesByDate: GamesByDate }) {
  const year = currentDate.getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {months.map(month => {
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);
        const gamesInMonth = Object.entries(gamesByDate).filter(([date]) => {
          const d = new Date(date);
          return d >= monthStart && d <= monthEnd;
        });
        const gameCount = gamesInMonth.reduce((sum, [, games]) => sum + games.length, 0);

        return (
          <div key={month} className="bg-card border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{getMonthName(month)}</h3>
              {gameCount > 0 && (
                <Badge variant="secondary" className="text-xs">{gameCount}</Badge>
              )}
            </div>
            <div className="space-y-2">
              {gamesInMonth.length > 0 ? (
                gamesInMonth.map(([date, games]) => (
                  <div key={date} className="text-sm">
                    <div className="text-muted-foreground mb-1">
                      {new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    {games.map(game => (
                      <GameBadge key={game.id} game={game} />
                    ))}
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No releases</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ currentDate, gamesByDate }: { currentDate: Date; gamesByDate: GamesByDate }) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getDaysInMonth(year, month);
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="grid grid-cols-7 gap-2 mb-2">
        {weekDays.map(day => (
          <div key={day} className="text-center font-semibold text-sm text-muted-foreground py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          const isCurrentMonth = day.getMonth() === month;
          const dateKey = formatDate(day);
          const gamesOnDay = gamesByDate[dateKey] || [];
          const isToday = formatDate(new Date()) === dateKey;

          return (
            <div
              key={idx}
              className={cn(
                "min-h-[120px] border rounded-lg p-2",
                !isCurrentMonth && "bg-muted/30",
                isToday && "border-primary border-2"
              )}
            >
              <div className={cn(
                "text-sm font-medium mb-2",
                !isCurrentMonth && "text-muted-foreground",
                isToday && "text-primary font-bold"
              )}>
                {day.getDate()}
              </div>
              <div className="space-y-1">
                {gamesOnDay.map(game => (
                  <GameBadge key={game.id} game={game} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ currentDate, gamesByDate }: { currentDate: Date; gamesByDate: GamesByDate }) {
  const weekDays = getWeekDays(new Date(currentDate));

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="grid grid-cols-7 gap-4">
        {weekDays.map((day, idx) => {
          const dateKey = formatDate(day);
          const gamesOnDay = gamesByDate[dateKey] || [];
          const isToday = formatDate(new Date()) === dateKey;
          const dayName = day.toLocaleDateString("en-US", { weekday: "short" });

          return (
            <div key={idx} className={cn("border rounded-lg p-3", isToday && "border-primary border-2")}>
              <div className="text-center mb-3">
                <div className={cn("font-semibold", isToday && "text-primary")}>{dayName}</div>
                <div className={cn("text-2xl font-bold", isToday && "text-primary")}>
                  {day.getDate()}
                </div>
                <div className="text-xs text-muted-foreground">
                  {day.toLocaleDateString("en-US", { month: "short" })}
                </div>
              </div>
              <div className="space-y-2">
                {gamesOnDay.length > 0 ? (
                  gamesOnDay.map(game => (
                    <GameBadge key={game.id} game={game} />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center">No releases</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameBadge({ game, compact = false }: { game: Game; compact?: boolean }) {
  const isDelayed = game.releaseStatus === "delayed";

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1 p-1 rounded hover:opacity-80 cursor-pointer transition-opacity",
            isDelayed ? "bg-destructive/20 border border-destructive/30" : "bg-muted"
          )}>
            <img
              src={game.coverUrl || "/placeholder-game-cover.jpg"}
              alt={game.title}
              className="w-6 h-6 rounded object-cover"
            />
            <span className={cn("text-xs truncate flex-1", isDelayed && "text-destructive font-medium")}>
              {game.title}
              {isDelayed && " (Delayed)"}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-xs">
            <p className="font-semibold">{game.title}</p>
            {isDelayed && (
              <Badge variant="destructive" className="mt-1 text-[10px] h-4">Delayed</Badge>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {game.releaseDate && new Date(game.releaseDate).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric"
              })}
            </p>
            {isDelayed && game.originalReleaseDate && (
              <p className="text-[10px] text-muted-foreground">
                Original: {new Date(game.originalReleaseDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric"
                })}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-2 p-2 rounded hover:opacity-80 cursor-pointer transition-all",
          isDelayed ? "bg-destructive/10 border border-destructive/20" : "bg-muted"
        )}>
          <img
            src={game.coverUrl || "/placeholder-game-cover.jpg"}
            alt={game.title}
            className="w-12 h-12 rounded object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className={cn("text-sm font-medium truncate", isDelayed && "text-destructive")}>
                {game.title}
              </p>
              {isDelayed && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1">Delayed</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {game.releaseDate && new Date(game.releaseDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
              })}
            </p>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="max-w-xs">
          <p className="font-semibold">{game.title}</p>
          {isDelayed && (
            <div className="flex flex-col gap-0.5 mt-1">
              <Badge variant="destructive" className="w-fit text-[10px] h-4">Delayed</Badge>
              {game.originalReleaseDate && (
                <p className="text-[10px] text-muted-foreground">
                  Was originally scheduled for: {new Date(game.originalReleaseDate).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  })}
                </p>
              )}
            </div>
          )}
          {game.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{game.summary}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {game.genres?.slice(0, 3).map(genre => (
              <Badge key={genre} variant="secondary" className="text-xs">{genre}</Badge>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
