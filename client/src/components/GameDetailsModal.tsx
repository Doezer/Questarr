import React, { useState, useEffect, lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TagList } from "@/components/ui/tag-list";
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
  HardDrive,
  CheckCircle2,
  Loader2,
  AlertCircle,
  PauseCircle,
  Trash2,
  ExternalLink,
  Users,
  Building2,
  ThumbsUp,
  FlaskConical,
  Info,
  Image,
  Link,
} from "lucide-react";
import { FaSteam, FaRedditAlien, FaDiscord, FaWikipediaW, FaTwitch } from "react-icons/fa";
import {
  SiGogdotcom,
  SiEpicgames,
  SiProtondb,
  SiPcgamingwiki,
  SiMetacritic,
  SiItchdotio,
} from "react-icons/si";
import { NexusModsIcon } from "./NexusModsIcon";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { type Game, type GameDownload } from "@shared/schema";
import StatusBadge, { getStatusLabel } from "./StatusBadge";
import { apiRequest } from "@/lib/queryClient";
import { cn, safeUrl, formatBytes, isDiscoveryId } from "@/lib/utils";

const GameDownloadDialog = lazy(() => import("./GameDownloadDialog"));

interface GameDetailsModalProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GameDownloadWithDownloader = GameDownload & { downloaderName: string | null };

type FileDeletionResult =
  | { deleted: true; path: string | null }
  | { deleted: false; reason: "outside-library-root" | "delete-failed"; path: string };

interface NexusMod {
  mod_id: number;
  name: string;
  summary: string;
  picture_url: string | null;
  mod_downloads: number;
  mod_unique_downloads: number;
  endorsement_count: number;
  version: string;
  updated_timestamp: number;
  domain_name: string;
  user: { name: string };
}

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

function getDerivedLinks(
  game: Game,
  pcgwUrl?: string | null
): Array<SiteLinkConfig & { href: string }> {
  const t = encodeURIComponent(game.title);

  return [
    {
      label: "PCGamingWiki",
      Icon: SiPcgamingwiki as IconComponent,
      colorClass: "text-teal-400",
      href:
        pcgwUrl ??
        (game.steamAppId
          ? `https://www.pcgamingwiki.com/api/redirect?steamappid=${game.steamAppId}`
          : `https://www.pcgamingwiki.com/w/index.php?search=${t}`),
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

function getTrackedDownloadStatusLabel(status: string): string {
  return status === "failed" ? "Aborted" : status;
}

// ── Source badge ──────────────────────────────────────────────────────────────

function getSourceLabel(source: string | null | undefined): string {
  if (source === "steam") return "Steam Wishlist";
  if (source === "api") return "Via API";
  return "Added Manually";
}

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === "steam") {
    return (
      <Badge variant="outline" className="gap-1.5 text-sky-400 border-sky-400/30">
        <FaSteam size={11} />
        <span className="hidden sm:inline">Steam Wishlist</span>
      </Badge>
    );
  }
  if (source === "api") {
    return (
      <Badge variant="outline" className="gap-1.5 text-purple-400 border-purple-400/30">
        <Zap className="w-3 h-3" />
        <span className="hidden sm:inline">Via API</span>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 text-muted-foreground">
      <UserRound className="w-3 h-3" />
      <span className="hidden sm:inline">Added Manually</span>
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
    <fieldset className="flex items-center gap-2 border-0 p-0 sm:gap-1">
      <legend className="sr-only">Your rating</legend>
      {[1, 2, 3, 4, 5].map((star) => {
        const fullValue = star * 2; // e.g. star=3 → fullValue=6
        const halfValue = star * 2 - 1; // e.g. star=3 → halfValue=5
        const isFull = display !== null && display >= fullValue;
        const isHalf = display !== null && display >= halfValue && display < fullValue;

        return (
          <span key={star} className="relative inline-flex w-7 h-7 sm:w-5 sm:h-5 overflow-visible">
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
                className="w-7 h-7 sm:w-5 sm:h-5 pointer-events-none text-muted-foreground absolute inset-0"
                aria-hidden="true"
              />
            )}
            {/* Visual star (accent-filled when full/half, muted otherwise) */}
            <Star
              className={`w-7 h-7 sm:w-5 sm:h-5 pointer-events-none transition-colors ${
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
    </fieldset>
  );
}

export default function GameDetailsModal({ game, open, onOpenChange }: GameDetailsModalProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [notesValue, setNotesValue] = useState<string>("");
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removeFromClient, setRemoveFromClient] = useState(true);
  const [deleteFiles, setDeleteFiles] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // GDM-3 & GDM-4: Reset isSummaryExpanded when game changes or modal closes
  useEffect(() => {
    if (!open) {
      setIsSummaryExpanded(false);
      setSelectedScreenshot(null);
      setDownloadOpen(false);
    }
  }, [open]);

  useEffect(() => {
    setIsSummaryExpanded(false);
    setNotesValue(game?.notes ?? "");
  }, [game?.id, game?.notes]);

  // GDM-2: Subscribe to socket download updates and invalidate the downloads query.
  // The shared socket connection stays alive app-wide, so only register/unregister handlers here.
  useEffect(() => {
    if (!open || !game?.id) return;
    const socket = getSocket();
    const handler = (gameId: string) => {
      if (gameId === game.id) {
        queryClient.invalidateQueries({ queryKey: [`/api/games/${game.id}/downloads`] });
      }
    };
    socket.on("downloadUpdate", handler);
    return () => {
      socket.off("downloadUpdate", handler);
    };
  }, [open, game?.id, queryClient]);

  const { data: gameDownloads = [], isLoading: downloadsLoading } = useQuery<
    GameDownloadWithDownloader[]
  >({
    queryKey: [`/api/games/${game?.id}/downloads`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/games/${game!.id}/downloads`);
      return res.json();
    },
    enabled: open && !!game?.id && !isDiscoveryId(game.id),
    refetchInterval: 5000,
  });

  const { data: nexusGameData, isError: nexusDomainError } = useQuery<{
    configured: boolean;
    domain: string | null;
  }>({
    queryKey: [`/api/nexusmods/game-domain`, game?.title],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/nexusmods/game-domain?title=${encodeURIComponent(game!.title)}`
      );
      return res.json();
    },
    enabled: open && !!game,
  });

  const nexusDomain = nexusGameData?.configured ? nexusGameData.domain : undefined;

  const { data: trendingMods = [], isLoading: trendingLoading } = useQuery<NexusMod[]>({
    queryKey: [`/api/nexusmods/trending-mods`, nexusDomain],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/nexusmods/trending-mods?domain=${encodeURIComponent(nexusDomain!)}&limit=10`
      );
      return res.json();
    },
    enabled: !!nexusDomain,
    staleTime: 60 * 60 * 1000,
  });

  const removeGameMutation = useMutation({
    mutationFn: async ({
      gameId,
      removeFromClient,
      deleteFiles,
    }: {
      gameId: string;
      removeFromClient: boolean;
      deleteFiles: boolean;
    }) => {
      if (removeFromClient) {
        await Promise.allSettled(
          gameDownloads
            .filter((dl) => dl.downloaderId && dl.downloadHash)
            .map((dl) =>
              apiRequest(
                "DELETE",
                `/api/downloaders/${dl.downloaderId}/downloads/${dl.downloadHash}?deleteFiles=${deleteFiles}`
              )
            )
        );
      }
      const res = await apiRequest("DELETE", `/api/games/${gameId}?deleteFiles=${deleteFiles}`);
      const data = await res.json();
      return { fileDeletion: data.fileDeletion as FileDeletionResult | null };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      if (data?.fileDeletion?.deleted === false) {
        const reasonText =
          data.fileDeletion.reason === "outside-library-root"
            ? "stored path is outside your configured library folder"
            : "deletion failed, check server logs";
        toast({
          description: `Game removed, but files were not deleted (${reasonText}): ${data.fileDeletion.path}`,
          variant: "destructive",
        });
      } else {
        toast({ description: "Game removed from collection" });
      }
      onOpenChange(false);
    },
    onError: () => {
      toast({ description: "Failed to remove game", variant: "destructive" });
    },
  });

  const userRatingMutation = useMutation<
    void,
    Error,
    { gameId: string; userRating: number | null }
  >({
    mutationFn: async ({ gameId, userRating }) => {
      await apiRequest("PATCH", `/api/games/${gameId}/user-rating`, { userRating });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: () => {
      toast({ description: "Failed to save your rating", variant: "destructive" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: async (notes: string | null) => {
      await apiRequest("PATCH", `/api/games/${game?.id}/notes`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: () => {
      toast({ description: "Failed to save notes", variant: "destructive" });
    },
  });

  const hiddenMutation = useHiddenMutation({
    hiddenSuccessMessage: "Game hidden from library",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to update game visibility",
  });

  const removeDownloadMutation = useMutation({
    mutationFn: async (downloadId: string) => {
      await apiRequest("DELETE", `/api/games/${game!.id}/downloads/${downloadId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/games/${game!.id}/downloads`] });
      queryClient.invalidateQueries({ queryKey: ["/api/downloads/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
      toast({ description: "Download record removed" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to remove download record" });
    },
  });

  const { data: pcgwData } = useQuery<{ url: string | null }>({
    queryKey: ["/api/external/pcgamingwiki", game?.steamAppId],
    queryFn: async ({ queryKey }) => {
      const [, steamAppId] = queryKey;
      const res = await apiRequest("GET", `/api/external/pcgamingwiki?steamAppId=${steamAppId}`);
      return res.json();
    },
    enabled: open && !!game?.steamAppId,
    staleTime: 24 * 60 * 60 * 1000,
  });

  if (!game) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* placeholder so Radix can fire onOpenChange(false) when X is clicked */}
      </Dialog>
    );
  }

  const handleUserRatingChange = (rating: number | null) => {
    userRatingMutation.mutate({ gameId: game.id, userRating: rating });
  };

  const SUMMARY_LIMIT = 280;
  const isSummaryLong = game.summary && game.summary.length > SUMMARY_LIMIT;

  // Include Steam link derived from steamAppId if IGDB didn't provide one (category 13)
  const rawWebsites = (game.igdbWebsites ?? []) as Array<{ category: number; url: string }>;
  const igdbWebsites =
    game.steamAppId && !rawWebsites.some((w) => w.category === 13)
      ? [
          ...rawWebsites,
          { category: 13, url: `https://store.steampowered.com/app/${game.steamAppId}` },
        ]
      : rawWebsites;

  const derivedLinks = getDerivedLinks(game, pcgwData?.url);
  // Optimistic display: show pending value immediately while the mutation is in flight.
  const currentUserRating = userRatingMutation.isPending
    ? (userRatingMutation.variables?.userRating ?? null)
    : (game.userRating ?? null);

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-4xl max-h-[95svh] sm:max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <DialogHeader className="flex-shrink-0 pb-0 pr-8 text-left">
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">
                        <StatusBadge status={game.status} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">
                      {getStatusLabel(game.status)}
                    </TooltipContent>
                  </Tooltip>
                  {game.earlyAccess && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">
                          <Badge className="text-xs bg-amber-500 border-amber-600 text-white gap-1">
                            <FlaskConical className="w-3 h-3" />
                            <span className="hidden sm:inline">Early Access</span>
                          </Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="sm:hidden">Early Access</TooltipContent>
                    </Tooltip>
                  )}
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
                        {new Date(game.releaseDate).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
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
                          <span className="hidden sm:inline">Results available</span>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="sm:hidden">
                        Downloads found on indexers
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">
                        <SourceBadge source={game.source} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">
                      {getSourceLabel(game.source)}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {game.coverUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={game.coverUrl}
                    alt={`${game.title} cover`}
                    className="w-20 sm:w-32 object-cover rounded-lg shadow-md"
                    style={{ aspectRatio: "3/4" }}
                    data-testid={`img-cover-${game.id}`}
                  />
                </div>
              )}
            </div>

            {/* Personal notes */}
            <div className="mt-3">
              <Textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={() => {
                  const trimmed = notesValue.trim() || null;
                  if (trimmed !== (game.notes ?? null)) {
                    notesMutation.mutate(trimmed);
                  }
                }}
                placeholder="Personal notes..."
                className="resize-none min-h-[56px] sm:min-h-[72px] text-sm"
                maxLength={10000}
                aria-label="Personal notes for this game"
                disabled={notesMutation.isPending}
              />
              {notesMutation.isPending && (
                <p className="text-xs text-muted-foreground mt-1">Saving...</p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mt-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-10 sm:h-9 sm:w-auto sm:px-3 sm:gap-2"
                    aria-label="Download"
                    onClick={() => setDownloadOpen(true)}
                    data-testid="button-download-game"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => hiddenMutation.mutate({ gameId: game.id, hidden: !game.hidden })}
                    disabled={hiddenMutation.isPending}
                    className="h-10 w-10 sm:h-9 sm:w-auto sm:px-3 sm:gap-2"
                    aria-label={game.hidden ? "Unhide" : "Hide"}
                    data-testid={`button-toggle-hidden-quick-${game.id}`}
                  >
                    {game.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    <span className="hidden sm:inline">
                      {hiddenMutation.isPending ? "Updating..." : game.hidden ? "Unhide" : "Hide"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">
                  {game.hidden ? "Unhide" : "Hide"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowRemoveConfirm(true)}
                    disabled={removeGameMutation.isPending}
                    className="h-10 w-10 sm:h-9 sm:w-auto sm:px-3 sm:gap-2"
                    aria-label="Remove"
                    data-testid={`button-remove-game-quick-${game.id}`}
                  >
                    <X className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {removeGameMutation.isPending ? "Removing..." : "Remove"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Remove</TooltipContent>
              </Tooltip>
            </div>
          </DialogHeader>

          {/* ── Tabs ── */}
          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 mt-4">
            <TabsList className="flex-shrink-0 w-full justify-start overflow-x-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="overview" aria-label="Overview" className="gap-1.5">
                    <Info className="h-3.5 w-3.5 sm:hidden" />
                    <span className="hidden sm:inline">Overview</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Overview</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="downloads" aria-label="Downloads" className="gap-1.5">
                    <Download className="h-3.5 w-3.5 sm:hidden" />
                    <span className="hidden sm:inline">Downloads</span>
                    {gameDownloads.length > 0 && (
                      <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs">
                        {gameDownloads.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Downloads</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="media" aria-label="Media" className="gap-1.5">
                    <Image className="h-3.5 w-3.5 sm:hidden" />
                    <span className="hidden sm:inline">Media</span>
                    {game.screenshots && game.screenshots.length > 0 && (
                      <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs">
                        {game.screenshots.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Media</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="links" aria-label="Links & Ratings" className="gap-1.5">
                    <Link className="h-3.5 w-3.5 sm:hidden" />
                    <span className="hidden sm:inline">Links &amp; Ratings</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent className="sm:hidden">Links &amp; Ratings</TooltipContent>
              </Tooltip>
              {nexusDomain && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="mods" aria-label="Mods" className="gap-1.5">
                      <NexusModsIcon className="h-3.5 w-3.5 text-amber-500 sm:mr-1" />
                      <span className="hidden sm:inline">Mods</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent className="sm:hidden">Mods</TooltipContent>
                </Tooltip>
              )}
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
                        className={cn(
                          "text-sm text-muted-foreground leading-relaxed break-words [overflow-wrap:anywhere]",
                          !isSummaryExpanded && "line-clamp-3 sm:line-clamp-5"
                        )}
                        data-testid={`text-summary-${game.id}`}
                      >
                        {game.summary}
                      </p>
                      {isSummaryLong && (
                        <Button
                          variant="link"
                          className="p-0 h-auto mt-1 font-semibold"
                          onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                        >
                          {isSummaryExpanded ? "Show less" : "Read more"}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
                    {game.genres && game.genres.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                          <Tag className="w-4 h-4" />
                          Genres
                        </h3>
                        <TagList
                          items={game.genres}
                          variant="secondary"
                          maxVisible={6}
                          getTestId={(g) => `badge-genre-${g.toLowerCase().replace(/\s+/g, "-")}`}
                        />
                      </div>
                    )}
                    {game.platforms && game.platforms.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          Platforms
                        </h3>
                        <TagList
                          items={game.platforms}
                          variant="outline"
                          maxVisible={8}
                          getTestId={(p) =>
                            `badge-platform-${p.toLowerCase().replace(/\s+/g, "-")}`
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Downloads tab ── */}
            <TabsContent
              value="downloads"
              forceMount
              className="flex-1 min-h-0 data-[state=inactive]:hidden"
            >
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
                                    {getTrackedDownloadStatusLabel(dl.status)}
                                  </span>
                                  {dl.errorMessage && (
                                    <span className="text-xs text-red-400 break-words max-w-full">
                                      {dl.errorMessage}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-start gap-3 flex-shrink-0">
                              <div className="text-right">
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                aria-label={`Remove download record ${dl.downloadTitle}`}
                                disabled={
                                  removeDownloadMutation.isPending &&
                                  removeDownloadMutation.variables === dl.id
                                }
                                onClick={() => removeDownloadMutation.mutate(dl.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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
                  {/* Ratings */}
                  <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <Star className="w-4 h-4" />
                      Ratings
                    </h3>
                    <div className="flex flex-wrap gap-4 mb-4">
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
                            <p className="text-xs text-muted-foreground mt-0.5">Community score</p>
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
                            <p className="text-xs text-muted-foreground mt-0.5">Aggregate score</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div data-testid="section-user-rating">
                      <h4 className="font-medium text-sm text-muted-foreground mb-2">
                        Your rating
                      </h4>
                      <StarRatingInput
                        value={currentUserRating}
                        onChange={handleUserRatingChange}
                      />
                    </div>
                  </div>

                  <div>
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
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 h-10 sm:h-9"
                                      >
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
                                <Button variant="outline" size="sm" className="gap-2 h-10 sm:h-9">
                                  <link.Icon size={16} className={link.colorClass} />
                                  <span className="hidden sm:inline">{link.label}</span>
                                </Button>
                              </a>
                            </TooltipTrigger>
                            <TooltipContent className="sm:hidden">{link.label}</TooltipContent>
                          </Tooltip>
                        ))}
                        {/* NexusMods: direct link when configured + found, fallback search when unconfigured or on error */}
                        {(nexusGameData || nexusDomainError) &&
                          (nexusDomain ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={safeUrl(`https://www.nexusmods.com/${nexusDomain}/mods/`)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button variant="outline" size="sm" className="gap-2 h-10 sm:h-9">
                                    <NexusModsIcon size={16} className="text-amber-500" />
                                    <span className="hidden sm:inline">NexusMods</span>
                                  </Button>
                                </a>
                              </TooltipTrigger>
                              <TooltipContent className="sm:hidden">NexusMods</TooltipContent>
                            </Tooltip>
                          ) : !nexusGameData?.configured || nexusDomainError ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={safeUrl(
                                    `https://www.nexusmods.com/games?keyword=${encodeURIComponent(game.title)}`
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button variant="outline" size="sm" className="gap-2 h-10 sm:h-9">
                                    <NexusModsIcon size={16} className="text-amber-500" />
                                    <span className="hidden sm:inline">NexusMods</span>
                                  </Button>
                                </a>
                              </TooltipTrigger>
                              <TooltipContent className="sm:hidden">NexusMods</TooltipContent>
                            </Tooltip>
                          ) : null)}
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Mods tab ── */}
            {nexusDomain && (
              <TabsContent value="mods" className="flex-1 min-h-0">
                <ScrollArea className="h-full">
                  <div className="space-y-4 pr-4 pb-2">
                    <h3 className="font-semibold flex items-center gap-2">
                      <NexusModsIcon className="w-4 h-4 text-amber-500" />
                      Trending Mods on Nexus Mods
                    </h3>
                    {trendingLoading ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
                        ))}
                      </div>
                    ) : trendingMods.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No trending mods found.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {trendingMods.map((mod) => (
                          <a
                            key={mod.mod_id}
                            href={safeUrl(
                              `https://www.nexusmods.com/${nexusDomain}/mods/${mod.mod_id}`
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group"
                          >
                            <Card className="overflow-hidden hover:ring-1 hover:ring-amber-500 transition-all">
                              <CardContent className="p-0 flex gap-3">
                                {mod.picture_url ? (
                                  <img
                                    src={mod.picture_url}
                                    alt={mod.name}
                                    className="w-20 h-20 object-cover flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-20 h-20 flex-shrink-0 bg-muted flex items-center justify-center">
                                    <NexusModsIcon className="w-6 h-6 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0 py-2 pr-2">
                                  <p className="text-sm font-medium truncate group-hover:text-amber-400 transition-colors">
                                    {mod.name}
                                  </p>
                                  {mod.summary && (
                                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                      {mod.summary}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <Download className="w-3 h-3" />
                                      {(mod.mod_unique_downloads ?? 0).toLocaleString()}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <ThumbsUp className="w-3 h-3" />
                                      {(mod.endorsement_count ?? 0).toLocaleString()}
                                    </span>
                                    {mod.user?.name && (
                                      <span className="truncate">by {mod.user.name}</span>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            )}
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

      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove game?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{game?.title}</strong> from your library. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(gameDownloads.some((dl) => dl.downloaderId && dl.downloadHash) ||
            game?.libraryPath) && (
            <div className="space-y-3 py-1">
              {gameDownloads.some((dl) => dl.downloaderId && dl.downloadHash) && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={removeFromClient}
                    onCheckedChange={(checked) => setRemoveFromClient(!!checked)}
                  />
                  <div>
                    <div className="text-sm font-medium leading-none">
                      Remove from download client
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Removes the{" "}
                      {gameDownloads.some((dl) => dl.downloadType === "usenet") &&
                      gameDownloads.some((dl) => dl.downloadType !== "usenet")
                        ? "torrent/NZB"
                        : gameDownloads.some((dl) => dl.downloadType === "usenet")
                          ? ".nzb"
                          : ".torrent"}{" "}
                      metadata from your downloader
                    </div>
                  </div>
                </label>
              )}
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={deleteFiles}
                  onCheckedChange={(checked) => setDeleteFiles(!!checked)}
                />
                <div>
                  <div className="text-sm font-medium leading-none">
                    Delete downloaded files from disk
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Permanently removes the game files
                  </div>
                </div>
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeGameMutation.mutate({ gameId: game!.id, removeFromClient, deleteFiles })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
