import React, { useState, lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Calendar,
  Star,
  Monitor,
  Gamepad2,
  Tag,
  Download,
  Eye,
  EyeOff,
  X,
  Search,
  UserRound,
  Zap,
  TrendingUp,
  Clock,
  HardDrive,
  CheckCircle2,
  Loader2,
  AlertCircle,
  PauseCircle,
  ExternalLink,
  Users,
  Building2,
} from "lucide-react";
import { FaSteam, FaRedditAlien, FaDiscord, FaWikipediaW, FaTwitch } from "react-icons/fa";
import {
  SiGogdotcom,
  SiEpicgames,
  SiProtondb,
  SiPcgamingwiki,
  SiMetacritic,
  SiItchdotio,
  SiNexusmods,
} from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { type Game, type GameDownload } from "@shared/schema";
import StatusBadge from "./StatusBadge";
import { apiRequest } from "@/lib/queryClient";
import { safeUrl, formatBytes, isDiscoveryId } from "@/lib/utils";

const GameDownloadDialog = lazy(() => import("./GameDownloadDialog"));

interface GameDetailsModalProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GameDownloadWithDownloader = GameDownload & { downloaderName: string | null };

function scoreColor(score: number): string {
  if (score >= 7.5) return "bg-emerald-600 text-white";
  if (score >= 6.0) return "bg-amber-500 text-white";
  return "bg-red-600 text-white";
}

// ── Website links config ──────────────────────────────────────────────────────

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

interface SiteLinkConfig {
  label: string;
  Icon: IconComponent;
  colorClass: string;
}

const IGDB_WEBSITE_CONFIG: Record<number, SiteLinkConfig> = {
  1: { label: "Official Site", Icon: ExternalLink as IconComponent, colorClass: "text-blue-400" },
  3: { label: "Wikipedia", Icon: FaWikipediaW as IconComponent, colorClass: "text-gray-300" },
  5: { label: "Twitch", Icon: FaTwitch as IconComponent, colorClass: "text-purple-500" },
  13: { label: "Steam", Icon: FaSteam as IconComponent, colorClass: "text-sky-400" },
  14: { label: "Reddit", Icon: FaRedditAlien as IconComponent, colorClass: "text-orange-500" },
  15: { label: "itch.io", Icon: SiItchdotio as IconComponent, colorClass: "text-red-400" },
  16: { label: "Epic Games", Icon: SiEpicgames as IconComponent, colorClass: "text-gray-200" },
  17: { label: "GOG", Icon: SiGogdotcom as IconComponent, colorClass: "text-purple-400" },
  18: { label: "Discord", Icon: FaDiscord as IconComponent, colorClass: "text-indigo-400" },
};

const URL_WEBSITE_PATTERNS: Array<{ pattern: RegExp; config: SiteLinkConfig }> = [
  { pattern: /store\.steampowered\.com/i, config: IGDB_WEBSITE_CONFIG[13] },
  { pattern: /reddit\.com/i, config: IGDB_WEBSITE_CONFIG[14] },
  { pattern: /itch\.io/i, config: IGDB_WEBSITE_CONFIG[15] },
  { pattern: /epicgames\.com/i, config: IGDB_WEBSITE_CONFIG[16] },
  { pattern: /gog\.com/i, config: IGDB_WEBSITE_CONFIG[17] },
  { pattern: /discord\.(gg|com)/i, config: IGDB_WEBSITE_CONFIG[18] },
  { pattern: /twitch\.tv/i, config: IGDB_WEBSITE_CONFIG[5] },
  { pattern: /wikipedia\.org/i, config: IGDB_WEBSITE_CONFIG[3] },
];

function resolveWebsiteConfig(w: { category?: number; url: string }): SiteLinkConfig | null {
  if (w.category && IGDB_WEBSITE_CONFIG[w.category]) return IGDB_WEBSITE_CONFIG[w.category];
  for (const { pattern, config } of URL_WEBSITE_PATTERNS) {
    if (pattern.test(w.url)) return config;
  }
  return null;
}

function getDerivedLinks(game: Game): Array<SiteLinkConfig & { href: string }> {
  const t = encodeURIComponent(game.title);
  return [
    {
      label: "PCGamingWiki",
      Icon: SiPcgamingwiki as IconComponent,
      colorClass: "text-teal-400",
      href: game.steamAppId
        ? `https://www.pcgamingwiki.com/api/redirect?steamappid=${game.steamAppId}`
        : `https://www.pcgamingwiki.com/w/index.php?search=${t}`,
    },
    {
      label: "HowLongToBeat",
      Icon: Clock as IconComponent,
      colorClass: "text-yellow-400",
      href: `https://howlongtobeat.com/?q=${t}`,
    },
    ...(game.steamAppId
      ? [
          {
            label: "ProtonDB",
            Icon: SiProtondb as IconComponent,
            colorClass: "text-orange-400",
            href: `https://www.protondb.com/app/${game.steamAppId}`,
          },
        ]
      : []),
    {
      label: "IsThereAnyDeal",
      Icon: Tag as IconComponent,
      colorClass: "text-green-400",
      href: `https://isthereanydeal.com/search/?q=${t}`,
    },
    {
      label: "NexusMods",
      Icon: SiNexusmods as IconComponent,
      colorClass: "text-amber-500",
      href: `https://www.nexusmods.com/games?keyword=${t}`,
    },
  ];
}

// ── Download status icon ──────────────────────────────────────────────────────

function DownloadStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case "downloading":
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case "paused":
      return <PauseCircle className="w-4 h-4 text-amber-400" />;
    case "failed":
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    default:
      return <HardDrive className="w-4 h-4 text-muted-foreground" />;
  }
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === "steam") {
    return (
      <Badge variant="outline" className="gap-1.5 text-sky-400 border-sky-400/30">
        <FaSteam size={11} />
        Steam Wishlist
      </Badge>
    );
  }
  if (source === "api") {
    return (
      <Badge variant="outline" className="gap-1.5 text-purple-400 border-purple-400/30">
        <Zap className="w-3 h-3" />
        Via API
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 text-muted-foreground">
      <UserRound className="w-3 h-3" />
      Added Manually
    </Badge>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/** Click target for a half-star or full-star position within StarRatingInput. */
function StarHitTarget({
  ratingValue,
  currentValue,
  isRightHalf,
  onHover,
  onChange,
}: {
  ratingValue: number;
  currentValue: number | null;
  isRightHalf: boolean;
  onHover: (v: number | null) => void;
  onChange: (v: number | null) => void;
}) {
  return (
    <button
      type="button"
      className={`absolute inset-0 ${isRightHalf ? "left-1/2 " : ""}w-1/2 z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:rounded-sm`}
      aria-label={`Rate ${ratingValue / 2} out of 5`}
      onMouseEnter={() => onHover(ratingValue)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onChange(currentValue === ratingValue ? null : ratingValue)}
    />
  );
}

/** Interactive star rating: 0.5–10 in 0.5 increments, keyboard + mouse accessible. */
function StarRatingInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const display = hovered ?? value;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const fullValue = star * 2; // e.g. star=3 → fullValue=6
        const halfValue = star * 2 - 1; // e.g. star=3 → halfValue=5
        const isFull = display !== null && display >= fullValue;
        const isHalf = display !== null && display >= halfValue && display < fullValue;

        return (
          <span key={star} className="relative inline-flex w-5 h-5">
            <StarHitTarget
              ratingValue={halfValue}
              currentValue={value}
              isRightHalf={false}
              onHover={setHovered}
              onChange={onChange}
            />
            <StarHitTarget
              ratingValue={fullValue}
              currentValue={value}
              isRightHalf={true}
              onHover={setHovered}
              onChange={onChange}
            />
            {/* Background star first so the accent star renders on top */}
            {isHalf && (
              <Star
                className="w-5 h-5 pointer-events-none text-muted-foreground absolute inset-0"
                aria-hidden="true"
              />
            )}
            {/* Visual star (accent-filled when full/half, muted otherwise) */}
            <Star
              className={`w-5 h-5 pointer-events-none transition-colors ${
                isFull
                  ? "text-accent fill-current"
                  : isHalf
                    ? "text-accent fill-current [clip-path:inset(0_50%_0_0)]"
                    : "text-muted-foreground"
              }`}
              aria-hidden="true"
            />
          </span>
        );
      })}
      {/* Always rendered so aria-live is a stable region for screen readers */}
      <span className="text-sm text-muted-foreground ml-1" aria-live="polite">
        {value !== null ? (
          <>
            {value % 2 === 0 ? value / 2 : `${Math.floor(value / 2)}.5`}/5
            <span className="sr-only"> ({value}/10)</span>
          </>
        ) : (
          "Not rated"
        )}
      </span>
    </div>
  );
}

export default function GameDetailsModal({ game, open, onOpenChange }: GameDetailsModalProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: gameDownloads = [], isLoading: downloadsLoading } = useQuery<
    GameDownloadWithDownloader[]
  >({
    queryKey: [`/api/games/${game?.id}/downloads`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/games/${game!.id}/downloads`);
      return res.json();
    },
    enabled: open && !!game?.id && !isDiscoveryId(game.id),
  });

  const removeGameMutation = useMutation({
    mutationFn: async (gameId: string) => {
      await apiRequest("DELETE", `/api/games/${gameId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game removed from collection" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ description: "Failed to remove game", variant: "destructive" });
    },
  });

  const userRatingMutation = useMutation<
    Game,
    Error,
    { gameId: string; userRating: number | null }
  >({
    mutationFn: async ({ gameId, userRating }) => {
      const res = await apiRequest("PATCH", `/api/games/${gameId}/user-rating`, { userRating });
      return res.json() as Promise<Game>;
    },
    onSuccess: (updatedGame) => {
      queryClient.setQueryData<Game[]>(["/api/games"], (old) =>
        old ? old.map((g) => (g.id === updatedGame.id ? updatedGame : g)) : old
      );
    },
    onError: () => {
      toast({ description: "Failed to save your rating", variant: "destructive" });
    },
  });

  const hiddenMutation = useHiddenMutation({
    hiddenSuccessMessage: "Game hidden from library",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to update game visibility",
  });

  if (!game) return null;

  const handleUserRatingChange = (rating: number | null) => {
    userRatingMutation.mutate({ gameId: game.id, userRating: rating });
  };

  const SUMMARY_LIMIT = 280;
  const isSummaryLong = game.summary && game.summary.length > SUMMARY_LIMIT;
  const displaySummary =
    isSummaryLong && !isSummaryExpanded
      ? `${game.summary?.slice(0, SUMMARY_LIMIT)}...`
      : game.summary;

  const igdbWebsites = (game.igdbWebsites ?? []) as Array<{ category: number; url: string }>;
  const derivedLinks = getDerivedLinks(game);
  // Optimistic display: show pending value immediately while the mutation is in flight.
  const currentUserRating = userRatingMutation.isPending
    ? (userRatingMutation.variables?.userRating ?? null)
    : (game.userRating ?? null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          {/* ── Header ── */}
          <DialogHeader className="flex-shrink-0 pb-0 pr-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <DialogTitle
                  className="text-2xl font-bold mb-2 leading-tight"
                  data-testid={`text-game-title-${game.id}`}
                >
                  {game.title}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Detailed information about {game.title}
                </DialogDescription>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={game.status} />
                  {game.rating ? (
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-4 h-4 text-accent" />
                      <span data-testid={`text-rating-${game.id}`}>{game.rating}/10</span>
                    </div>
                  ) : null}
                  {game.releaseDate && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span data-testid={`text-release-date-${game.id}`}>
                        {new Date(game.releaseDate).getFullYear()}
                      </span>
                    </div>
                  )}
                  {game.searchResultsAvailable && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="gap-1 border-violet-500 text-violet-400 cursor-default"
                          data-testid={`badge-search-results-${game.id}`}
                        >
                          <Search className="w-3 h-3" />
                          Results available
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Downloads found on indexers</TooltipContent>
                    </Tooltip>
                  )}
                  <SourceBadge source={game.source} />
                </div>
              </div>
              {game.coverUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={game.coverUrl}
                    alt={`${game.title} cover`}
                    className="w-32 object-cover rounded-lg shadow-md"
                    style={{ aspectRatio: "3/4" }}
                    data-testid={`img-cover-${game.id}`}
                  />
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setDownloadOpen(true)}
                data-testid="button-download-game"
              >
                <Download className="w-4 h-4" />
                Download
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => hiddenMutation.mutate({ gameId: game.id, hidden: !game.hidden })}
                disabled={hiddenMutation.isPending}
                className="gap-2"
                data-testid={`button-toggle-hidden-quick-${game.id}`}
              >
                {game.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {hiddenMutation.isPending ? "Updating..." : game.hidden ? "Unhide" : "Hide"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => removeGameMutation.mutate(game.id)}
                disabled={removeGameMutation.isPending}
                className="gap-2"
                data-testid={`button-remove-game-quick-${game.id}`}
              >
                <X className="w-4 h-4" />
                {removeGameMutation.isPending ? "Removing..." : "Remove"}
              </Button>
            </div>
          </DialogHeader>

          {/* ── Tabs ── */}
          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 mt-4">
            <TabsList className="flex-shrink-0 w-full justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="downloads">
                Downloads
                {gameDownloads.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs">
                    {gameDownloads.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="media">
                Media
                {game.screenshots && game.screenshots.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs">
                    {game.screenshots.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="links">Links & Ratings</TabsTrigger>
            </TabsList>

            {/* ── Overview tab ── */}
            <TabsContent value="overview" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-5 pr-4 pb-2">
                  {/* Summary */}
                  {game.summary && (
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Gamepad2 className="w-4 h-4" />
                        About
                      </h3>
                      <p
                        className="text-sm text-muted-foreground leading-relaxed"
                        data-testid={`text-summary-${game.id}`}
                      >
                        {displaySummary}
                        {isSummaryLong && (
                          <Button
                            variant="link"
                            className="p-0 h-auto ml-1 font-semibold"
                            onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                          >
                            {isSummaryExpanded ? "Show less" : "Read more"}
                          </Button>
                        )}
                      </p>
                    </div>
                  )}

                  {/* Metadata grid */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {game.rating && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-1">
                          IGDB score
                        </h4>
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-accent fill-current" />
                          <span className="text-sm font-medium">{game.rating}/10</span>
                        </div>
                      </div>
                    )}
                    {game.releaseDate && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-1">
                          Release Date
                        </h4>
                        <p className="text-sm" data-testid={`text-full-release-date-${game.id}`}>
                          {new Date(game.releaseDate).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                    {game.addedAt && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-1">
                          Added to Collection
                        </h4>
                        <p className="text-sm">{new Date(game.addedAt).toLocaleDateString()}</p>
                      </div>
                    )}
                    {game.developers && game.developers.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          Developer{game.developers.length > 1 ? "s" : ""}
                        </h4>
                        <p className="text-sm">{game.developers.join(", ")}</p>
                      </div>
                    )}
                    {game.publishers && game.publishers.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          Publisher{game.publishers.length > 1 ? "s" : ""}
                        </h4>
                        <p className="text-sm">{game.publishers.join(", ")}</p>
                      </div>
                    )}
                  </div>

                  {/* Genres and Platforms */}
                  <div className="grid md:grid-cols-2 gap-5">
                    {game.genres && game.genres.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                          <Tag className="w-4 h-4" />
                          Genres
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {game.genres.map((genre, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              data-testid={`badge-genre-${genre.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              {genre}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {game.platforms && game.platforms.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          Platforms
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {game.platforms.map((platform, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              data-testid={`badge-platform-${platform.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              {platform}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Downloads tab ── */}
            <TabsContent value="downloads" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-3 pr-4 pb-2">
                  {downloadsLoading ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Loading downloads…
                    </div>
                  ) : gameDownloads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      <HardDrive className="w-8 h-8 opacity-40" />
                      <p className="text-sm">No downloads recorded for this game.</p>
                    </div>
                  ) : (
                    gameDownloads.map((dl) => (
                      <Card key={dl.id} className="bg-card/60">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2 min-w-0">
                              <DownloadStatusIcon status={dl.status} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium leading-snug truncate">
                                  {dl.downloadTitle}
                                </p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                  {dl.downloaderName && (
                                    <span className="text-xs text-muted-foreground">
                                      via {dl.downloaderName}
                                    </span>
                                  )}
                                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                                    {dl.downloadType}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground capitalize">
                                    {dl.status}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              {dl.fileSize ? (
                                <p className="text-sm font-medium">{formatBytes(dl.fileSize)}</p>
                              ) : null}
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {dl.addedAt ? new Date(dl.addedAt).toLocaleDateString() : "—"}
                              </p>
                              {dl.completedAt && (
                                <p className="text-xs text-emerald-400 mt-0.5">
                                  Done {new Date(dl.completedAt).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Media tab ── */}
            <TabsContent
              value="media"
              forceMount
              className="flex-1 min-h-0 data-[state=inactive]:hidden"
            >
              <ScrollArea className="h-full">
                <div className="pr-4 pb-2">
                  {game.screenshots && game.screenshots.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {game.screenshots.map((screenshot, index) => (
                        <Card
                          key={index}
                          className="overflow-hidden cursor-pointer hover-elevate"
                          onClick={() => setSelectedScreenshot(screenshot)}
                          data-testid={`screenshot-${index}`}
                        >
                          <CardContent className="p-0">
                            <img
                              src={screenshot}
                              alt={`${game.title} screenshot ${index + 1}`}
                              className="w-full h-24 object-cover"
                            />
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      <Monitor className="w-8 h-8 opacity-40" />
                      <p className="text-sm">No screenshots available.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Links & Ratings tab ── */}
            <TabsContent
              value="links"
              forceMount
              className="flex-1 min-h-0 data-[state=inactive]:hidden"
            >
              <ScrollArea className="h-full">
                <div className="space-y-6 pr-4 pb-2">
                  {/* Your Rating */}
                  <div data-testid="section-user-rating">
                    <h4 className="font-medium text-sm text-muted-foreground mb-2">Your rating</h4>
                    <StarRatingInput value={currentUserRating} onChange={handleUserRatingChange} />
                  </div>

                  {/* Ratings */}
                  {(game.rating || game.aggregatedRating) && (
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Star className="w-4 h-4" />
                        Ratings
                      </h3>
                      <div className="flex flex-wrap gap-4">
                        {game.rating ? (
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold ${scoreColor(game.rating)}`}
                            >
                              {game.rating.toFixed(1)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-sm font-medium">
                                <Users className="w-3.5 h-3.5" />
                                IGDB Users
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Community score
                              </p>
                            </div>
                          </div>
                        ) : null}
                        {game.aggregatedRating ? (
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold ${scoreColor(game.aggregatedRating)}`}
                            >
                              {game.aggregatedRating.toFixed(1)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 text-sm font-medium">
                                <SiMetacritic size={14} />
                                Critics
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Aggregate score
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <TooltipProvider>
                    {/* IGDB website links */}
                    {igdbWebsites.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2">
                          <ExternalLink className="w-4 h-4" />
                          Official &amp; Store Pages
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {igdbWebsites
                            .map((w) => ({ w, cfg: resolveWebsiteConfig(w) }))
                            .filter(({ cfg }) => cfg !== null)
                            .map(({ w, cfg }, i) => {
                              const { Icon, colorClass, label } = cfg!;
                              return (
                                <Tooltip key={i}>
                                  <TooltipTrigger asChild>
                                    <a
                                      href={safeUrl(w.url)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Button variant="outline" size="sm" className="gap-2">
                                        <Icon size={16} className={colorClass} />
                                        <span className="hidden sm:inline">{label}</span>
                                      </Button>
                                    </a>
                                  </TooltipTrigger>
                                  <TooltipContent className="sm:hidden">{label}</TooltipContent>
                                </Tooltip>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* Derived community links */}
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Community Resources
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {derivedLinks.map((link, i) => (
                          <Tooltip key={i}>
                            <TooltipTrigger asChild>
                              <a
                                href={safeUrl(link.href)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Button variant="outline" size="sm" className="gap-2">
                                  <link.Icon size={16} className={link.colorClass} />
                                  <span className="hidden sm:inline">{link.label}</span>
                                </Button>
                              </a>
                            </TooltipTrigger>
                            <TooltipContent className="sm:hidden">{link.label}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  </TooltipProvider>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Screenshot Lightbox */}
      {selectedScreenshot && (
        <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Screenshot</DialogTitle>
              <DialogDescription className="sr-only">Full size game screenshot</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              <img
                src={selectedScreenshot}
                alt={`${game.title} screenshot`}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                data-testid="screenshot-lightbox"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {downloadOpen && (
        <Suspense fallback={null}>
          <GameDownloadDialog game={game} open={downloadOpen} onOpenChange={setDownloadOpen} />
        </Suspense>
      )}
    </>
  );
}
