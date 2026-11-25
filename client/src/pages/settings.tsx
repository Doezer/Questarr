import { useState, useEffect, useRef, useMemo } from "react";
import { SteamLibraryImport } from "@/components/SteamLibraryImport";
import { SteamPlaytimeSync } from "@/components/SteamPlaytimeSync";
import { SteamAchievementsSync } from "@/components/SteamAchievementsSync";
import { RetroAchievementsSync } from "@/components/RetroAchievementsSync";
import { PlayniteSyncStatus } from "@/components/PlayniteSyncStatus";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Server,
  Key,
  RefreshCw,
  Search,
  Download,
  AlertCircle,
  Eye,
  EyeOff,
  Newspaper,
  Lock,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Gamepad2,
  Trash2,
  Bell,
  Monitor,
  Radio,
  Sparkles,
  FlaskConical,
  Archive,
  Filter,
  Trophy,
  Wand2,
} from "lucide-react";
import { routePaths } from "@/lib/routes";
import { NexusModsIcon } from "@/components/NexusModsIcon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PathBrowser } from "@/components/PathBrowser";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { stripRouterBase } from "@/lib/app-path";
import { apiFetch, apiRequest, clearSearchCache } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import WebhookSubscriptionsCard from "@/components/WebhookSubscriptionsCard";
import { useToast } from "@/hooks/use-toast";
import { ApiKeysCard } from "@/components/ApiKeysCard";
import { TagsSettings } from "@/components/TagsSettings";
import AutoDownloadRulesSettings from "@/components/AutoDownloadRulesSettings";
import ReleaseScoringSettings from "@/components/ReleaseScoringSettings";
import ReleaseNameBlacklistSettings from "@/components/ReleaseNameBlacklistSettings";
import ClassificationReviewSettings from "@/components/ClassificationReviewSettings";
import ClassificationSettings from "@/components/ClassificationSettings";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import {
  SETTINGS_PAGES,
  legacySettingsSlug,
  settingsPageFromPath,
  settingsPagePath,
} from "@/lib/settings-pages";
import { settingsPageIcon } from "@/lib/settings-page-icons";
import { GHOST_UNLOCK_KEY } from "@/lib/ghost-mode";
import {
  THEMES,
  THEME_CONFIGS,
  THEME_KEY,
  type Theme,
  getCurrentTheme,
  migrateLegacyTheme,
  applyThemeClass,
  setTheme,
} from "@/lib/theme-mode";
import PasswordSettings from "@/components/PasswordSettings";
import {
  downloadRulesSchema,
  DEFAULT_NOTIFICATION_PREFERENCES,
  downloaderDebugLoggingResponseSchema,
  type Config,
  type UserSettings,
  type DownloadRules,
  type NotificationPreferences,
  type NotificationEvent,
  type DownloaderDebugLoggingResponse,
  type UpgradePolicy,
  DEFAULT_UPGRADE_POLICY,
  resolveUpgradePolicy,
} from "@shared/schema";
import { parseJsonStringArray, CANONICAL_PLATFORMS } from "@shared/title-utils";
import PlatformsSettings from "@/components/PlatformsSettings";
import ImportSettings from "@/components/ImportSettings";
import { IgdbHelpPopover, IgdbTestConnectionButton } from "@/components/IgdbCredentialsHelper";

interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
  valid: boolean;
}
const NOTIFICATION_EVENT_ROWS: { key: NotificationEvent; label: string; group: string }[] = [
  { key: "gameReleased", label: "Game Released", group: "library" },
  { key: "gameDelayed", label: "Game Delayed", group: "library" },
  { key: "downloadCompleted", label: "Download Completed", group: "downloads" },
  { key: "downloadFailed", label: "Download Aborted", group: "downloads" },
  { key: "autoDownload", label: "Auto-Download Started", group: "downloads" },
  { key: "gameAvailable", label: "Game Found on Indexer", group: "downloads" },
  { key: "multipleResults", label: "Multiple Releases Found", group: "downloads" },
  { key: "gameUpdates", label: "Game Updates and New Packs/Add-ons", group: "downloads" },
  { key: "xrelRelease", label: "Scene/P2P Release (xREL)", group: "integrations" },
  { key: "steamSync", label: "Steam Wishlist Synced", group: "integrations" },
  { key: "achievementUnlocked", label: "Achievements Unlocked", group: "integrations" },
  { key: "errorDetected", label: "Error Detected", group: "system" },
];

function isHttpUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "http:";
  } catch {
    return false;
  }
}

function SettingsToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: React.ReactNode;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow
      id={id}
      label={label}
      description={description}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  );
}

/** Next to a card's Save button: tells the user this card has edits that are not saved yet. */
function UnsavedHint({ show }: Readonly<{ show: boolean }>) {
  // The live region stays mounted so assistive tech announces the text when it appears.
  return (
    <output className="mr-3 self-center text-xs font-medium text-amber-700 in-[.dark]:text-amber-400">
      {show ? "Unsaved changes" : ""}
    </output>
  );
}

function SettingsSaveButton({
  onClick,
  pending,
  dirty = false,
  disabled = false,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  pending: boolean;
  dirty?: boolean;
  /** Disable the button without showing the "Saving..." label (another save is in flight). */
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex justify-end pt-4 border-t">
      <UnsavedHint show={dirty} />
      <Button onClick={onClick} disabled={pending || disabled} className="gap-2">
        {pending ? (
          <>
            <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Icon className="h-4 w-4" />
            {label}
          </>
        )}
      </Button>
    </div>
  );
}

function SettingsFilterCard({
  icon: Icon,
  title,
  description,
  onSave,
  savePending,
  saveDisabled = false,
  saveDirty,
  saveIcon,
  saveLabel,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onSave: () => void;
  savePending: boolean;
  saveDisabled?: boolean;
  saveDirty: boolean;
  saveIcon: React.ComponentType<{ className?: string }>;
  saveLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle as="h2" className="text-lg">
            {title}
          </CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {children}
        <SettingsSaveButton
          onClick={onSave}
          pending={savePending}
          dirty={saveDirty}
          disabled={saveDisabled}
          icon={saveIcon}
          label={saveLabel}
        />
      </CardContent>
    </Card>
  );
}

const SETTINGS_SAVE_KEY = ["settings-save"] as const;

function SettingsEntryIcon({ slug }: Readonly<{ slug: string }>) {
  const Icon = settingsPageIcon(slug);
  return <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** One section of the settings, rendered only while its page is the one being viewed. */
function SettingsPanel({
  id,
  active,
  children,
}: Readonly<{ id: string; active: string; children: React.ReactNode }>) {
  if (id !== active) return null;
  return (
    <section aria-labelledby="settings-page-title" className="space-y-6">
      {children}
    </section>
  );
}

type SettingsSectionId =
  "auto-search" | "content-filter" | "library-filter" | "quests" | "steam-sync" | "telemetry";

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  dirty: boolean;
  updates: Partial<UserSettings>;
  successMessage: string;
  reset: () => void;
}

/** Edit account integrations and preferences, including owned-library import progress. */
export default function SettingsPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const page = settingsPageFromPath(location);
  const activeTab = page?.id ?? "";
  // Older links name a tab (?tab=) or a card that has since moved (#classification-review).
  // The hash is not part of `search`, so history events also re-read the URL: a link that only
  // adds a hash to the page already open must still reach the section the card is in now.
  useEffect(() => {
    const follow = () => {
      const slug = legacySettingsSlug(window.location.search, window.location.hash);
      if (slug && settingsPageFromPath(stripRouterBase(window.location.pathname))?.slug !== slug) {
        navigate(`${settingsPagePath(slug)}${window.location.hash}`, { replace: true });
      }
    };
    follow();
    const events = ["pushState", "replaceState", "hashchange"];
    for (const event of events) window.addEventListener(event, follow);
    return () => {
      for (const event of events) window.removeEventListener(event, follow);
    };
  }, [search, navigate]);
  // /settings on its own is the list of sections on a phone; elsewhere it opens the first one
  useEffect(() => {
    const openFirstSection = () => {
      // Read the live URL: the effect above may just have moved an older link to its section
      if (settingsPageFromPath(stripRouterBase(window.location.pathname))) return;
      if (legacySettingsSlug(window.location.search, window.location.hash)) return;
      if (phoneQuery?.matches) return;
      navigate(settingsPagePath(SETTINGS_PAGES[0]?.slug ?? "general"), { replace: true });
    };
    const phoneQuery = globalThis.matchMedia?.("(max-width: 767px)");
    openFirstSection();
    // Widening past the breakpoint hides the section list: open the first section then
    phoneQuery?.addEventListener?.("change", openFirstSection);
    return () => phoneQuery?.removeEventListener?.("change", openFirstSection);
  }, [page, navigate]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [ghostUnlocked] = useLocalStorageState(GHOST_UNLOCK_KEY, false);
  const [selectedTheme, setSelectedTheme] = useLocalStorageState<Theme>(
    THEME_KEY,
    getCurrentTheme(ghostUnlocked)
  );

  // Normalize the stored theme: useLocalStorageState returns whatever is in localStorage
  // once THEME_KEY exists, without validating it against THEMES or the Ghost unlock state.
  // A corrupted value, or one set directly (e.g. via devtools), would otherwise reach
  // applyThemeClass() and either throw (unknown theme) or bypass the Ghost unlock.
  const effectiveTheme: Theme =
    THEMES.includes(selectedTheme) && (selectedTheme !== "ghost" || ghostUnlocked)
      ? selectedTheme
      : "default";

  // Migrate legacy theme keys once on mount. Not done inline in the useLocalStorageState
  // initializer above, since that runs during render and migration has localStorage
  // side effects (React may render a component without committing it).
  useEffect(() => {
    migrateLegacyTheme(ghostUnlocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the normalized value so a corrected theme sticks for later loads.
  useEffect(() => {
    if (effectiveTheme !== selectedTheme) {
      setSelectedTheme(effectiveTheme);
    }
  }, [effectiveTheme, selectedTheme, setSelectedTheme]);

  // Apply theme class on mount and when theme changes
  useEffect(() => {
    applyThemeClass(effectiveTheme);
  }, [effectiveTheme]);

  const handleThemeChange = (theme: Theme) => {
    setTheme(theme, ghostUnlocked);
    setSelectedTheme(theme);
  };

  const {
    data: config,
    isLoading: configLoading,
    error: configError,
  } = useQuery<Config>({
    queryKey: ["/api/config"],
  });

  const { data: igdbSettings } = useQuery<{
    configured: boolean;
    source?: "env" | "database";
    clientId?: string;
  }>({
    queryKey: ["/api/settings/igdb"],
    queryFn: () => apiRequest("GET", "/api/settings/igdb").then((res) => res.json()),
  });

  const {
    data: userSettings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
    retry: 3, // Retry up to 3 times as migrations might be running
  });

  const { data: user } = useQuery<{ id: string; username: string; steamId64?: string }>({
    queryKey: ["/api/auth/me"],
  });

  // Local state for form
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(true);
  const [autoSearchUnreleased, setAutoSearchUnreleased] = useState(false);
  const [upgradePolicy, setUpgradePolicy] = useState<UpgradePolicy>(DEFAULT_UPGRADE_POLICY);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [searchIntervalHours, setSearchIntervalHours] = useState(6);
  const [igdbRateLimitPerSecond, setIgdbRateLimitPerSecond] = useState(3);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [appriseMode, setAppriseMode] = useState<"api" | "cli">("api");
  const [appriseApiUrl, setAppriseApiUrl] = useState("");
  const [appriseKey, setAppriseKey] = useState("");
  const [appriseUrls, setAppriseUrls] = useState("");
  const [appriseUsername, setAppriseUsername] = useState("");
  const [apprisePassword, setApprisePassword] = useState("");
  const appriseLoadedRef = useRef(false);
  const settingsLoadedRef = useRef(false);

  // Local state for Steam form
  const [steamIdInput, setSteamIdInput] = useState("");
  const [steamSyncEnabled, setSteamSyncEnabled] = useState(false);
  const [steamSyncIntervalHours, setSteamSyncIntervalHours] = useState(24);

  // Local state for forms
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [downloadRules, setDownloadRules] = useState<DownloadRules | null>(null);
  const [releaseNameBlacklist, setReleaseNameBlacklist] = useState<string[]>([]);
  const [preferredPlatform, setPreferredPlatform] = useState<string>("");
  const [xrelSceneReleases, setXrelSceneReleases] = useState(true);
  const [xrelP2pReleases, setXrelP2pReleases] = useState(false);
  const [hideAdultContent, setHideAdultContent] = useState(true);
  const [hideAgeRestrictedContent, setHideAgeRestrictedContent] = useState(true);
  const [hideShelvedByDefault, setHideShelvedByDefault] = useState(true);
  const [hideOwnedInHasResults, setHideOwnedInHasResults] = useState(true);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [questsEnabled, setQuestsEnabled] = useState(true);
  const [xrelApiBase, setXrelApiBase] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [showNexusApiKey, setShowNexusApiKey] = useState(false);
  const [steamApiKey, setSteamApiKey] = useState("");
  const [showSteamApiKey, setShowSteamApiKey] = useState(false);
  const [typesafeApiUrl, setTypesafeApiUrl] = useState("");
  const [typesafeApiKey, setTypesafeApiKey] = useState("");
  const [typesafeModel, setTypesafeModel] = useState("");
  const [showTypesafeApiKey, setShowTypesafeApiKey] = useState(false);

  // Sync with fetched settings. Guarded by settingsLoadedRef so a background
  // refetch (e.g. after saving one section) doesn't clobber unsaved edits the
  // user has made in another section of this form.
  useEffect(() => {
    if (userSettings && !settingsLoadedRef.current) {
      setAutoSearchEnabled(userSettings.autoSearchEnabled);
      setAutoSearchUnreleased(userSettings.autoSearchUnreleased ?? false);
      setUpgradePolicy(resolveUpgradePolicy(undefined, userSettings.upgradePolicy));
      setAutoDownloadEnabled(userSettings.autoDownloadEnabled);
      setSearchIntervalHours(userSettings.searchIntervalHours);
      const rateLimit = userSettings.igdbRateLimitPerSecond;
      setIgdbRateLimitPerSecond(
        Number.isInteger(rateLimit) ? Math.min(4, Math.max(1, rateLimit)) : 3
      );
      if (userSettings.notificationPreferences) {
        try {
          setNotifPrefs({
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            ...JSON.parse(userSettings.notificationPreferences),
          });
        } catch {
          setNotifPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
          toast({
            title: "Notification preferences could not be loaded, reset to defaults",
            variant: "destructive",
          });
        }
      }

      // Parse download rules from JSON string
      if (userSettings.downloadRules) {
        try {
          const parsed = JSON.parse(userSettings.downloadRules);
          const validated = downloadRulesSchema.parse(parsed);
          setDownloadRules(validated);
        } catch (error) {
          console.warn("Failed to parse download rules", error);
          setDownloadRules(null);
        }
      } else {
        setDownloadRules(null);
      }
      setReleaseNameBlacklist(parseJsonStringArray(userSettings.releaseNameBlacklist));
      setPreferredPlatform(userSettings.preferredPlatform ?? "");
      setXrelSceneReleases(userSettings.xrelSceneReleases ?? true);
      setXrelP2pReleases(userSettings.xrelP2pReleases ?? false);
      setSteamSyncEnabled(userSettings.steamSyncEnabled ?? false);
      setSteamSyncIntervalHours(userSettings.steamSyncIntervalHours ?? 24);
      setHideAdultContent(userSettings.hideAdultContent ?? true);
      setHideAgeRestrictedContent(userSettings.hideAgeRestrictedContent ?? true);
      setHideShelvedByDefault(userSettings.hideShelvedByDefault ?? true);
      setHideOwnedInHasResults(userSettings.hideOwnedInHasResults ?? true);
      setTelemetryEnabled(userSettings.telemetryEnabled ?? false);
      setQuestsEnabled(userSettings.questsEnabled ?? true);
      settingsLoadedRef.current = true;
    }
    if (config?.xrel?.apiBase !== undefined) {
      setXrelApiBase(config.xrel.apiBase);
    }

    if (igdbSettings?.clientId) {
      setIgdbClientId(igdbSettings.clientId);
    }
    if (igdbSettings?.configured) {
      setIgdbClientSecret("");
    }
    if (user?.steamId64) {
      setSteamIdInput(user.steamId64);
    }
  }, [userSettings, config, igdbSettings, user, toast]);

  // SSL Settings State
  const [sslEnabled, setSslEnabled] = useState(false);
  const [sslPort, setSslPort] = useState(9898);
  const [sslCertPath, setSslCertPath] = useState("");
  const [sslKeyPath, setSslKeyPath] = useState("");
  const [sslRedirectHttp, setSslRedirectHttp] = useState(false);

  const { data: sslSettings } = useQuery({
    queryKey: ["/api/settings/ssl"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings/ssl");
      return res.json();
    },
  });

  const {
    data: downloaderDebugLogging,
    isLoading: isDownloaderDebugLoggingLoading,
    isError: isDownloaderDebugLoggingError,
  } = useQuery<DownloaderDebugLoggingResponse>({
    queryKey: ["/api/downloaders/debug-logging"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/downloaders/debug-logging");
      return downloaderDebugLoggingResponseSchema.parse(await res.json());
    },
  });

  const updateDownloaderDebugLoggingMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/downloaders/debug-logging", { enabled });
      return downloaderDebugLoggingResponseSchema.parse(await res.json());
    },
    onSuccess: (data: DownloaderDebugLoggingResponse) => {
      queryClient.setQueryData(["/api/downloaders/debug-logging"], data);
      toast({
        title: data.enabled
          ? "Downloader debug logging enabled"
          : "Downloader debug logging disabled",
        description: data.enabled
          ? "Full downloader responses will now be written to the log at debug level."
          : undefined,
      });
    },
    onError: () => {
      toast({ title: "Failed to update downloader debug logging", variant: "destructive" });
    },
  });

  const { data: appriseSettings } = useQuery<{
    configured: boolean;
    contextLinksEnabled?: boolean;
    mode: "api" | "cli";
    apiUrl: string | null;
    key: string | null;
    urls: string | null;
    username?: string;
    password?: string;
  }>({
    queryKey: ["/api/settings/apprise"],
    queryFn: () => apiRequest("GET", "/api/settings/apprise").then((r) => r.json()),
  });

  useEffect(() => {
    if (appriseSettings && !appriseLoadedRef.current) {
      if (appriseSettings.mode) setAppriseMode(appriseSettings.mode);
      if (appriseSettings.apiUrl !== undefined) setAppriseApiUrl(appriseSettings.apiUrl ?? "");
      if (appriseSettings.key !== undefined) setAppriseKey(appriseSettings.key ?? "");
      if (appriseSettings.urls !== undefined) setAppriseUrls(appriseSettings.urls ?? "");
      setAppriseUsername(appriseSettings.username ?? "");
      setApprisePassword(appriseSettings.password ?? "");
      appriseLoadedRef.current = true;
    }
  }, [appriseSettings]);

  const { data: nexusmodsSettings } = useQuery<{
    configured: boolean;
    source?: "env" | "database";
  }>({
    queryKey: ["/api/settings/nexusmods"],
    queryFn: () => apiRequest("GET", "/api/settings/nexusmods").then((r) => r.json()),
  });

  const updateAppriseMutation = useMutation({
    mutationFn: async (data: {
      mode: "api" | "cli";
      apiUrl?: string;
      key?: string;
      urls?: string;
      username?: string;
      password?: string;
    }) => {
      const res = await apiRequest("POST", "/api/settings/apprise", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/apprise"] });
      toast({ title: "Apprise settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save Apprise settings", variant: "destructive" });
    },
  });

  const appriseSaveDisabled =
    updateAppriseMutation.isPending ||
    (appriseMode === "api"
      ? !appriseApiUrl.trim() || (!appriseKey.trim() && !appriseUrls.trim())
      : !appriseUrls.trim());

  const testAppriseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/apprise/test");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Test failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Test notification sent successfully" });
    },
    onError: (err: Error) => {
      toast({ title: `Apprise test failed: ${err.message}`, variant: "destructive" });
    },
  });

  const handleNotifPrefChange = (
    key: NotificationEvent,
    channel: "inApp" | "apprise" | "includeShelved" | "includeCompleted",
    checked: boolean
  ) => {
    const updated = { ...notifPrefs, [key]: { ...notifPrefs[key], [channel]: checked } };
    setNotifPrefs(updated);
    if (notifPrefSaveTimeoutRef.current) clearTimeout(notifPrefSaveTimeoutRef.current);
    notifPrefSaveTimeoutRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({
        updates: { notificationPreferences: JSON.stringify(updated) },
        successMessage: "Your notification preferences have been saved.",
      });
    }, 500);
  };

  const { data: steamKeySettings } = useQuery<{
    apiKeyConfigured: boolean;
    source?: "env" | "database" | null;
  }>({
    queryKey: ["/api/settings/steam"],
    queryFn: () => apiRequest("GET", "/api/settings/steam").then((r) => r.json()),
  });

  const updateSteamKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/settings/steam", { apiKey });
      return res.json();
    },
    onSuccess: (_data, apiKey) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/steam"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steam/playtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steam/achievements"] });
      setSteamApiKey("");
      toast({ title: apiKey ? "Steam API key saved" : "Steam API key removed" });
    },
    onError: () => {
      toast({ title: "Failed to save the Steam API key", variant: "destructive" });
    },
  });

  const updateNexusMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/settings/nexusmods", { apiKey });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/nexusmods"] });
      setNexusApiKey("");
      toast({ title: "Nexus Mods API key saved" });
    },
    onError: () => {
      toast({ title: "Failed to save Nexus Mods API key", variant: "destructive" });
    },
  });

  const handleSaveNexus = () => {
    if (!nexusApiKey.trim()) return;
    updateNexusMutation.mutate(nexusApiKey.trim());
  };

  const { data: typesafeSettings } = useQuery<{
    configured: boolean;
    apiUrl?: string;
    model?: string;
  }>({
    queryKey: ["/api/settings/typesafe"],
    queryFn: () => apiRequest("GET", "/api/settings/typesafe").then((r) => r.json()),
  });

  const updateTypesafeMutation = useMutation({
    mutationFn: async (data: { apiUrl: string; apiKey?: string; model: string }) => {
      const res = await apiRequest("POST", "/api/settings/typesafe", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/typesafe"] });
      setTypesafeApiKey("");
      toast({ title: "TypeSafe settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save TypeSafe settings", variant: "destructive" });
    },
  });

  const clearTypesafeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/typesafe");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/typesafe"] });
      setTypesafeApiUrl("");
      setTypesafeApiKey("");
      setTypesafeModel("");
      toast({ title: "TypeSafe integration disabled" });
    },
    onError: () => {
      toast({ title: "Failed to disable TypeSafe integration", variant: "destructive" });
    },
  });

  const handleSaveTypesafe = () => {
    const trimmedKey = typesafeApiKey.trim();
    // A key is only required the first time; once configured, saving with the field left
    // blank reuses the stored key (e.g. to change just the URL or model).
    if (!trimmedKey && !typesafeSettings?.configured) return;
    updateTypesafeMutation.mutate({
      apiUrl: typesafeApiUrl.trim(),
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      model: typesafeModel.trim(),
    });
  };

  useEffect(() => {
    if (typesafeSettings?.apiUrl) {
      setTypesafeApiUrl(typesafeSettings.apiUrl);
    }
    if (typesafeSettings?.model) {
      setTypesafeModel(typesafeSettings.model);
    }
  }, [typesafeSettings?.apiUrl, typesafeSettings?.model]);

  const [certInfo, setCertInfo] = useState<CertInfo | null>(null); // State for cert info
  const [isCertBrowserOpen, setIsCertBrowserOpen] = useState(false);
  const [isKeyBrowserOpen, setIsKeyBrowserOpen] = useState(false);

  useEffect(() => {
    if (sslSettings) {
      setSslEnabled(sslSettings.enabled);
      setSslPort(sslSettings.port);
      setSslCertPath(sslSettings.certPath || "");
      setSslKeyPath(sslSettings.keyPath || "");
      setSslRedirectHttp(sslSettings.redirectHttp);
      setCertInfo(sslSettings.certInfo);
    }
  }, [sslSettings]);

  const [selectedCert, setSelectedCert] = useState<File | null>(null);
  const [selectedKey, setSelectedKey] = useState<File | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const notifPrefSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const uploadCertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCert || !selectedKey) throw new Error("Please select both files");

      const formData = new FormData();
      formData.append("cert", selectedCert);
      formData.append("key", selectedKey);

      const res = await apiFetch("/api/settings/ssl/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to upload certificate");
      }

      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Certificate Uploaded",
        description: data.message,
      });
      setSslCertPath(data.certPath);
      setSslKeyPath(data.keyPath);
      setSelectedCert(null);
      setSelectedKey(null);
      // Reset file inputs
      if (certInputRef.current) certInputRef.current.value = "";
      if (keyInputRef.current) keyInputRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSslMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/ssl", {
        enabled: sslEnabled,
        port: sslPort,
        certPath: sslCertPath,
        keyPath: sslKeyPath,
        redirectHttp: sslRedirectHttp,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "SSL Settings Saved",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ssl"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateCertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/ssl/generate");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Certificate Generated",
        description: data.message,
      });
      setSslCertPath(data.certPath);
      setSslKeyPath(data.keyPath);
    },
    onError: (error: Error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveSsl = () => {
    updateSslMutation.mutate();
  };

  const updateSettingsMutation = useMutation({
    mutationKey: SETTINGS_SAVE_KEY,
    mutationFn: async ({
      updates,
      successMessage,
    }: {
      updates: Partial<UserSettings>;
      successMessage: string;
      /** Which card asked, so only its Save button shows "Saving...". Unset for auto-saves. */
      section?: string;
    }) => {
      const res = await apiRequest("PATCH", "/api/settings", updates);

      // Check if response is HTML (which means the route wasn't found and Vite served index.html)
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("API route not found. Please restart the server to apply changes.");
      }

      return { data: await res.json(), successMessage };
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Settings Updated",
        description: data.successMessage,
      });
      // Content-filter settings change what the library returns, collections included.
      queryClient.removeQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/achievements/progress"] });
      // The PATCH answers with the saved settings: make the fields this save sent the baseline
      // right away so Discard never restores stale values, even if the refetch below fails.
      // Only those keys are merged, so an overlapping save is never overwritten by an older reply.
      const saved = data.data as Partial<UserSettings> | null;
      if (saved && typeof saved === "object") {
        const sentKeys = Object.keys(variables.updates) as (keyof UserSettings)[];
        queryClient.setQueryData<UserSettings>(["/api/settings"], (cached) => {
          if (!cached) return cached;
          const next = { ...cached };
          for (const key of sentKeys) {
            if (key in saved) (next as Record<string, unknown>)[key] = saved[key];
          }
          return next;
        });
      }
      // Returned so the mutation stays pending until the refetch lands: Save all / Discard stay
      // disabled and the unload guard stays on until the saved baseline is up to date.
      return queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      console.error("Settings update error:", error);

      let message = error.message;
      if (message.includes("Unexpected token") || message.includes("JSON")) {
        message = "Server response invalid. Please restart the server.";
      }

      toast({
        title: "Update Failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateAdvancedSettingsMutation = useMutation({
    mutationFn: async ({
      updates,
      successMessage,
    }: {
      updates: Partial<UserSettings>;
      successMessage: string;
    }) => {
      const res = await apiRequest("PATCH", "/api/settings", updates);

      // Check if response is HTML (which means the route wasn't found and Vite served index.html)
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("API route not found. Please restart the server to apply changes.");
      }

      return { data: await res.json(), successMessage };
    },
    onSuccess: (data) => {
      // Empty successMessage means the caller (the unified IGDB save button) shows its own
      // combined toast instead, describing exactly which parts were actually saved.
      if (data.successMessage) {
        toast({
          title: "Settings Updated",
          description: data.successMessage,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      // Content-filter settings change what the library returns, collections included.
      queryClient.removeQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/achievements/progress"] });
    },
    onError: (error: Error) => {
      console.error("Settings update error:", error);

      let message = error.message;
      if (message.includes("Unexpected token") || message.includes("JSON")) {
        message = "Server response invalid. Please restart the server.";
      }

      toast({
        title: "Update Failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateIgdbMutation = useMutation({
    mutationFn: async () => {
      const payload: { clientId: string; clientSecret?: string } = {
        clientId: igdbClientId,
      };
      if (igdbClientSecret) {
        payload.clientSecret = igdbClientSecret;
      }
      const res = await apiRequest("POST", "/api/settings/igdb", payload);
      return res.json();
    },
    onSuccess: () => {
      // The unified IGDB save button (handleSaveIgdb) shows its own combined toast describing
      // exactly which parts were saved, instead of this mutation announcing on its own.
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/igdb"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const refreshMetadataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/games/refresh-metadata");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Metadata Refresh",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Metadata Refresh Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [libraryHealthResult, setLibraryHealthResult] = useState<{
    drifted: Array<{ id: string; title: string; libraryPath: string }>;
    orphaned: Array<{ path: string }>;
  } | null>(null);

  const libraryHealthMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/games/library-health-check");
      return res.json();
    },
    onSuccess: (data) => {
      setLibraryHealthResult({ drifted: data.drifted, orphaned: data.orphaned });
      toast({
        title: "Library Health Check",
        description:
          data.drifted.length === 0 && data.orphaned.length === 0
            ? "Library is in sync."
            : `${data.drifted.length} drifted, ${data.orphaned.length} orphaned`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Library Health Check Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = configLoading || settingsLoading;
  const error = configError;

  // A link such as /settings/connections#igdb-config lands on the card it names. Runs
  // once the tab content exists, which is after the loading branch below gives way. The
  // history events cover a link followed while its tab is already open: only the hash
  // changes then, so nothing here re-renders.
  useEffect(() => {
    if (isLoading) return;
    const scrollToHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    scrollToHash();
    const events = ["pushState", "replaceState", "hashchange"];
    for (const event of events) window.addEventListener(event, scrollToHash);
    return () => {
      for (const event of events) window.removeEventListener(event, scrollToHash);
    };
  }, [isLoading, activeTab, search]);

  const saveXrelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/xrel", {
        apiBase: xrelApiBase.trim() || undefined,
        xrelSceneReleases,
        xrelP2pReleases,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings Updated",
        description: "xREL.to options have been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      // Content-filter settings change what the library returns, collections included.
      queryClient.removeQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/achievements/progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveXrel = () => {
    saveXrelMutation.mutate();
  };

  // Single save button covers both the credentials fields and the rate limit below them. Both
  // parts only run when they actually changed (comparing against the last-loaded values), and
  // the summary toast below is built from what actually got saved -- rather than each mutation
  // firing its own fixed-text toast, which would show a stale/misleading combination now that
  // one click can trigger either, both, or neither.
  const handleSaveIgdb = async () => {
    // Omitting the secret and keeping the existing one is only safe when that existing secret
    // actually lives in the DB (source === "database"): the server pairs a DB clientId with a
    // DB secret, so if the current credentials are env-sourced there's no DB secret to pair a
    // new clientId with, and a clientId-only update would silently do nothing.
    const hasDbSecretToPairWith = igdbSettings?.source === "database";
    const originalClientId = igdbSettings?.clientId ?? "";
    const trimmedClientId = igdbClientId.trim();
    const trimmedClientSecret = igdbClientSecret.trim();
    const bothCredentialsProvided = !!(trimmedClientId && trimmedClientSecret);
    const hasCredentialChange = trimmedClientId !== originalClientId || !!trimmedClientSecret;
    const shouldSaveCredentials =
      bothCredentialsProvided || (hasDbSecretToPairWith && hasCredentialChange);
    // Only an actual attempted change that can't be saved counts as "incomplete" -- an
    // env-sourced clientId sitting unchanged in the field (prefilled on load) must not block
    // an unrelated rate-limit-only save.
    const attemptingIncompleteCredentials = hasCredentialChange && !shouldSaveCredentials;

    if (attemptingIncompleteCredentials) {
      toast({
        title: "Missing Credentials",
        description: "Please provide both Client ID and Client Secret.",
        variant: "destructive",
      });
      return;
    }

    const originalRateLimit = userSettings?.igdbRateLimitPerSecond ?? 3;
    const shouldSaveRateLimit = igdbRateLimitPerSecond !== originalRateLimit;

    if (!shouldSaveCredentials && !shouldSaveRateLimit) {
      return;
    }

    const results = await Promise.allSettled([
      shouldSaveCredentials ? updateIgdbMutation.mutateAsync() : Promise.resolve(undefined),
      shouldSaveRateLimit
        ? updateAdvancedSettingsMutation.mutateAsync({
            updates: { igdbRateLimitPerSecond },
            successMessage: "",
          })
        : Promise.resolve(undefined),
    ]);

    const credentialsSaved = shouldSaveCredentials && results[0].status === "fulfilled";
    const rateLimitSaved = shouldSaveRateLimit && results[1].status === "fulfilled";

    // A failed part already showed its own error toast via the mutation's onError; only
    // announce what actually succeeded, and stay silent if everything attempted failed.
    let description: string | null = null;
    if (credentialsSaved && rateLimitSaved) {
      description = "Your IGDB credentials and rate limit have been saved.";
    } else if (credentialsSaved) {
      description = "Your IGDB credentials have been saved.";
    } else if (rateLimitSaved) {
      description = "Your IGDB rate limit has been saved.";
    }

    if (description) {
      toast({ title: "IGDB Settings Updated", description });
    }
  };

  const updateSteamIdMutation = useMutation({
    mutationFn: async (steamId: string) => {
      const res = await apiRequest("PATCH", "/api/user/steam-id", { steamId });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Steam ID Updated",
        description: "Your Steam ID has been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/steam/achievements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/achievements/progress"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveSteamId = () => {
    if (!steamIdInput) return;
    updateSteamIdMutation.mutate(steamIdInput);
  };

  // Cards whose fields are edited locally and sent with one Save button. Comparing each card's
  // fields with the saved settings gives its "unsaved changes" state, which feeds the card
  // hint, the bar at the top of the page and the warning when closing the tab.
  const settingsSections = useMemo<SettingsSection[]>(() => {
    if (!userSettings) return [];
    const saved = userSettings;
    return [
      {
        id: "auto-search",
        label: "Auto-Search & Download",
        dirty:
          autoSearchEnabled !== saved.autoSearchEnabled ||
          autoSearchUnreleased !== (saved.autoSearchUnreleased ?? false) ||
          upgradePolicy !== resolveUpgradePolicy(undefined, saved.upgradePolicy) ||
          autoDownloadEnabled !== saved.autoDownloadEnabled ||
          searchIntervalHours !== saved.searchIntervalHours ||
          preferredPlatform !== (saved.preferredPlatform ?? ""),
        updates: {
          autoSearchEnabled,
          autoSearchUnreleased,
          upgradePolicy,
          autoDownloadEnabled,
          searchIntervalHours,
          preferredPlatform: preferredPlatform || null,
        },
        successMessage: "Your auto-search preferences have been saved.",
        reset: () => {
          setAutoSearchEnabled(saved.autoSearchEnabled);
          setAutoSearchUnreleased(saved.autoSearchUnreleased ?? false);
          setUpgradePolicy(resolveUpgradePolicy(undefined, saved.upgradePolicy));
          setAutoDownloadEnabled(saved.autoDownloadEnabled);
          setSearchIntervalHours(saved.searchIntervalHours);
          setPreferredPlatform(saved.preferredPlatform ?? "");
        },
      },
      {
        id: "content-filter",
        label: "Content Filtering",
        dirty:
          hideAdultContent !== (saved.hideAdultContent ?? true) ||
          hideAgeRestrictedContent !== (saved.hideAgeRestrictedContent ?? true),
        updates: { hideAdultContent, hideAgeRestrictedContent },
        successMessage: "Content filtering preferences have been saved.",
        reset: () => {
          setHideAdultContent(saved.hideAdultContent ?? true);
          setHideAgeRestrictedContent(saved.hideAgeRestrictedContent ?? true);
        },
      },
      {
        id: "library-filter",
        label: "Library Filtering",
        dirty:
          hideShelvedByDefault !== (saved.hideShelvedByDefault ?? true) ||
          hideOwnedInHasResults !== (saved.hideOwnedInHasResults ?? true),
        updates: { hideShelvedByDefault, hideOwnedInHasResults },
        successMessage: "Your library filtering defaults have been saved.",
        reset: () => {
          setHideShelvedByDefault(saved.hideShelvedByDefault ?? true);
          setHideOwnedInHasResults(saved.hideOwnedInHasResults ?? true);
        },
      },
      {
        id: "quests",
        label: "Backlog quests",
        dirty: questsEnabled !== (saved.questsEnabled ?? true),
        updates: { questsEnabled },
        successMessage: questsEnabled ? "Backlog quests enabled." : "Backlog quests disabled.",
        reset: () => setQuestsEnabled(saved.questsEnabled ?? true),
      },
      {
        id: "steam-sync",
        label: "Steam Wishlist sync",
        dirty:
          steamSyncEnabled !== (saved.steamSyncEnabled ?? false) ||
          steamSyncIntervalHours !== (saved.steamSyncIntervalHours ?? 24),
        updates: { steamSyncEnabled, steamSyncIntervalHours },
        successMessage: "Your Steam Wishlist auto-sync preferences have been saved.",
        reset: () => {
          setSteamSyncEnabled(saved.steamSyncEnabled ?? false);
          setSteamSyncIntervalHours(saved.steamSyncIntervalHours ?? 24);
        },
      },
      {
        id: "telemetry",
        label: "Telemetry",
        dirty: telemetryEnabled !== (saved.telemetryEnabled ?? false),
        updates: { telemetryEnabled },
        successMessage: telemetryEnabled
          ? "Telemetry enabled. Detected errors will be reported automatically."
          : "Telemetry disabled.",
        reset: () => setTelemetryEnabled(saved.telemetryEnabled ?? false),
      },
    ];
  }, [
    userSettings,
    autoSearchEnabled,
    autoSearchUnreleased,
    upgradePolicy,
    autoDownloadEnabled,
    searchIntervalHours,
    preferredPlatform,
    hideAdultContent,
    hideAgeRestrictedContent,
    hideShelvedByDefault,
    hideOwnedInHasResults,
    questsEnabled,
    steamSyncEnabled,
    steamSyncIntervalHours,
    telemetryEnabled,
  ]);

  const dirtySections = useMemo(() => settingsSections.filter((x) => x.dirty), [settingsSections]);
  const isSectionDirty = (id: SettingsSectionId) => dirtySections.some((x) => x.id === id);
  // Only the card whose button was pressed shows "Saving...", not every card on the page.
  const isSectionSaving = (id: string) =>
    updateSettingsMutation.isPending && updateSettingsMutation.variables?.section === id;

  const saveSection = (id: SettingsSectionId) => {
    const section = settingsSections.find((x) => x.id === id);
    if (!section) return;
    updateSettingsMutation.mutate({
      updates: section.updates,
      successMessage: section.successMessage,
      section: id,
    });
  };

  const saveAllSections = () => {
    updateSettingsMutation.mutate({
      updates: Object.assign({}, ...dirtySections.map((x) => x.updates)),
      successMessage: "Your settings have been saved.",
      section: "all",
    });
  };

  const discardAllSections = () => {
    for (const section of dirtySections) section.reset();
  };

  // Closing or reloading the tab would drop these edits without a word.
  const hasUnsavedChanges = dirtySections.length > 0;
  // `isPending` only follows the latest mutate() call, so count every in-flight settings save.
  const settingsSavesInFlight = useIsMutating({ mutationKey: SETTINGS_SAVE_KEY });
  const guardUnload = hasUnsavedChanges || settingsSavesInFlight > 0;
  useEffect(() => {
    if (!guardUnload) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guardUnload]);

  const handleSaveAutoSearch = () => saveSection("auto-search");
  const handleSaveContentFilter = () => saveSection("content-filter");
  const handleSaveLibraryFilters = () => saveSection("library-filter");
  const handleSaveQuests = () => saveSection("quests");
  const handleSaveSteamSync = () => saveSection("steam-sync");
  const handleSaveTelemetry = () => saveSection("telemetry");

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 motion-safe:animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading configuration...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Error Loading Configuration</CardTitle>
            <CardDescription>Failed to load configuration. Please try again later.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const contentFilteringCard = (
    <SettingsFilterCard
      icon={EyeOff}
      title="Content Filtering"
      description="Control which games appear in your library and discovery results"
      onSave={handleSaveContentFilter}
      savePending={isSectionSaving("content-filter")}
      saveDisabled={settingsSavesInFlight > 0}
      saveDirty={isSectionDirty("content-filter")}
      saveIcon={EyeOff}
      saveLabel="Save Content Filtering"
    >
      <SettingsToggleRow
        id="hide-adult-content"
        label="Hide erotic content"
        description="Hide games flagged with an explicit/erotic theme from your library, search, and discovery pages"
        checked={hideAdultContent}
        onCheckedChange={setHideAdultContent}
      />
      <SettingsToggleRow
        id="hide-age-restricted-content"
        label="Hide age-restricted content"
        description="Hide games rated ESRB Adults Only (AO) or PEGI 18 from your library, search, and discovery pages"
        checked={hideAgeRestrictedContent}
        onCheckedChange={setHideAgeRestrictedContent}
      />
    </SettingsFilterCard>
  );

  const libraryFilterRows = [
    {
      id: "hide-shelved-by-default",
      label: "Hide shelved games by default",
      description:
        "Keep shelved games out of the library view unless you filter by the Shelved status",
      checked: hideShelvedByDefault,
      onCheckedChange: setHideShelvedByDefault,
    },
    {
      id: "hide-owned-in-has-results",
      label: "Hide owned games in “Has Results” filter",
      description: "When the Has Results filter is active, skip games you already own",
      checked: hideOwnedInHasResults,
      onCheckedChange: setHideOwnedInHasResults,
    },
  ];

  const libraryFilteringCard = (
    <SettingsFilterCard
      icon={Filter}
      title="Library Filtering"
      description="Choose which games are hidden by default in your library"
      onSave={handleSaveLibraryFilters}
      savePending={isSectionSaving("library-filter")}
      saveDisabled={settingsSavesInFlight > 0}
      saveDirty={isSectionDirty("library-filter")}
      saveIcon={Archive}
      saveLabel="Save Library Filtering"
    >
      {libraryFilterRows.map((row) => (
        <SettingsToggleRow key={row.id} {...row} />
      ))}
    </SettingsFilterCard>
  );

  const questsCard = (
    <SettingsFilterCard
      icon={Trophy}
      title="Backlog quests"
      description="Optional weekly and monthly challenges picked from your backlog, with medals"
      onSave={handleSaveQuests}
      savePending={isSectionSaving("quests")}
      saveDisabled={settingsSavesInFlight > 0}
      saveDirty={isSectionDirty("quests")}
      saveIcon={Archive}
      saveLabel="Save Backlog quests"
    >
      <SettingsToggleRow
        id="quests-enabled"
        label="Show backlog quests"
        description="Turn the quests, medals and backlog progress off if you would rather not see them"
        checked={questsEnabled}
        onCheckedChange={setQuestsEnabled}
      />
    </SettingsFilterCard>
  );

  return (
    <div className="h-full overflow-auto p-4 pb-20 sm:p-6 md:pb-6">
      <div className="mx-auto mb-6 max-w-4xl">
        {page && (
          <Link
            href="/settings"
            className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        )}
        <h1 id="settings-page-title" className="text-2xl font-bold tracking-tight">
          {page?.title ?? "Settings"}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {page?.description ?? "Configure your preferences and system settings"}
        </p>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-6">
        {hasUnsavedChanges && (
          <div
            data-testid="unsaved-changes-bar"
            className="sticky top-0 z-20 flex flex-col gap-3 rounded-md border border-amber-500/60 bg-card p-3 shadow-md sm:flex-row sm:items-center sm:justify-between"
          >
            <output className="block text-sm">
              <span className="font-medium">Unsaved changes</span> in{" "}
              {dirtySections.map((x) => x.label).join(", ")}.
            </output>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={discardAllSections}
                disabled={settingsSavesInFlight > 0}
              >
                Discard
              </Button>
              <Button
                className="min-h-11"
                onClick={saveAllSections}
                disabled={settingsSavesInFlight > 0}
              >
                {isSectionSaving("all") ? "Saving..." : "Save all"}
              </Button>
            </div>
          </div>
        )}

        {/* Database Migration Alert */}
        {settingsError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Database Migration Required</AlertTitle>
            <AlertDescription>
              The user settings table hasn't been created yet. Please run{" "}
              <code className="px-1 py-0.5 bg-muted rounded">npm run db:migrate</code> to update the
              database schema, then restart the server.
            </AlertDescription>
          </Alert>
        )}

        {!page && (
          <nav aria-label="Settings sections" className="mx-auto max-w-4xl md:hidden">
            <ul className="divide-y rounded-lg border bg-card">
              {SETTINGS_PAGES.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={settingsPagePath(entry.slug)}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/60"
                  >
                    <SettingsEntryIcon slug={entry.slug} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{entry.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {entry.description}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <SettingsPanel id="appearance" active={activeTab}>
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Monitor className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Theme
                </CardTitle>
              </div>
              <CardDescription>Select the visual theme for Questarr</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="theme-select" className="text-sm font-medium">
                    Select Theme
                  </Label>
                  <Select
                    value={effectiveTheme}
                    onValueChange={(value) => handleThemeChange(value as Theme)}
                  >
                    <SelectTrigger id="theme-select" className="w-full sm:w-64">
                      <SelectValue placeholder="Select a theme">
                        {THEME_CONFIGS[effectiveTheme].name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {THEMES.map((theme) => {
                        const config = THEME_CONFIGS[theme];
                        // Only show Ghost if unlocked
                        if (theme === "ghost" && !ghostUnlocked) return null;
                        return (
                          <SelectItem key={theme} value={theme}>
                            <div className="flex flex-col">
                              <span className="font-medium">{config.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {config.description}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Purely cosmetic &mdash; changes the visual appearance, nothing else changes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {contentFilteringCard}

          {libraryFilteringCard}

          {questsCard}

          <PlatformsSettings />

          <TagsSettings />

          <Card id="setup-wizard">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Wand2 className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Setup wizard
                </CardTitle>
              </div>
              <CardDescription>
                Answer a few questions about your platforms and how you use Questarr, and only see
                the settings that matter to you. Services you already configured can be skipped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate(routePaths.setupWizard)}>Run the setup wizard</Button>
            </CardContent>
          </Card>
        </SettingsPanel>

        <SettingsPanel id="discovery" active={activeTab}>
          {/* Auto-Search Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Search className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Auto-Search & Download
                </CardTitle>
              </div>
              <CardDescription>
                Automatically search for and download releases for wanted games
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {/* Auto Search Toggle */}
                <SettingRow
                  id="auto-search"
                  label="Enable Auto-Search"
                  description="Periodically search indexers for wanted games"
                  checked={autoSearchEnabled}
                  onCheckedChange={setAutoSearchEnabled}
                />

                {/* Search Interval */}
                {autoSearchEnabled && (
                  <div className="space-y-2 pl-4 border-l-2">
                    <Label htmlFor="search-interval" className="text-sm font-medium">
                      Search Interval (hours)
                    </Label>
                    <Input
                      id="search-interval"
                      type="number"
                      min="1"
                      max="168"
                      value={searchIntervalHours}
                      onChange={(e) =>
                        setSearchIntervalHours(
                          Math.min(168, Math.max(1, Number.parseInt(e.target.value) || 6))
                        )
                      }
                      className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                      How often to search for new releases (1-168 hours)
                    </p>
                  </div>
                )}

                {/* Auto Search Unreleased Toggle */}
                {autoSearchEnabled && (
                  <SettingRow
                    id="auto-search-unreleased"
                    label="Search Unreleased Games"
                    description="Include unreleased (upcoming/delayed) games in search"
                    className="pl-4 border-l-2"
                    checked={autoSearchUnreleased}
                    onCheckedChange={setAutoSearchUnreleased}
                  />
                )}

                {/* Default policy for newer versions of owned games */}
                {autoSearchEnabled && (
                  <div className="flex flex-col gap-2 pl-4 border-l-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="upgrade-policy-default" className="text-sm font-medium">
                        Updates for Owned Games
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Default for newer versions and repacks. Each game can override it. Download
                        automatically only takes a release whose name proves a newer version than
                        the installed one, and needs a scoring profile.
                      </p>
                    </div>
                    <Select
                      value={upgradePolicy}
                      onValueChange={(value) => setUpgradePolicy(value as UpgradePolicy)}
                    >
                      <SelectTrigger
                        id="upgrade-policy-default"
                        className="h-10 w-full sm:h-9 sm:w-56 sm:shrink-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="notify">Notify me</SelectItem>
                        <SelectItem value="auto">Download automatically</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Auto Download Toggle */}
                {autoSearchEnabled && (
                  <SettingRow
                    id="auto-download"
                    label="Auto-Download Single Releases"
                    description="Automatically download when only one release is found"
                    className="pl-4 border-l-2"
                    checked={autoDownloadEnabled}
                    onCheckedChange={setAutoDownloadEnabled}
                  />
                )}
              </div>

              {/* Preferred Platform */}
              <div className="space-y-2 pt-4 border-t">
                <Label htmlFor="preferred-platform" className="text-sm font-medium">
                  Preferred Platform
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pre-filter results to this platform in the download dialog and auto-search. PC
                  also matches releases with no explicit platform tag.
                </p>
                <Select
                  value={preferredPlatform || "__none__"}
                  onValueChange={(v) => setPreferredPlatform(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger id="preferred-platform" className="w-full sm:w-48">
                    <SelectValue placeholder="No preference" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No preference</SelectItem>
                    {CANONICAL_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end pt-4 border-t">
                <UnsavedHint show={isSectionDirty("auto-search")} />
                <Button
                  onClick={handleSaveAutoSearch}
                  disabled={settingsSavesInFlight > 0}
                  className="gap-2"
                >
                  {isSectionSaving("auto-search") ? (
                    <>
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Save Auto-Search
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <AutoDownloadRulesSettings
            rules={downloadRules}
            onChange={setDownloadRules}
            onReset={() => setDownloadRules(null)}
          />
          <ReleaseNameBlacklistSettings
            blacklistTerms={releaseNameBlacklist}
            onTermsChange={setReleaseNameBlacklist}
          />
        </SettingsPanel>

        <SettingsPanel id="scoring" active={activeTab}>
          <ReleaseScoringSettings />
          <ClassificationSettings />
          <ClassificationReviewSettings />
        </SettingsPanel>

        <SettingsPanel id="notifications" active={activeTab}>
          {/* Apprise Integration Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <CardTitle as="h2" className="text-lg">
                    Apprise Push Notifications
                  </CardTitle>
                </div>
                {appriseSettings?.configured ? (
                  <Badge
                    variant="default"
                    className="bg-emerald-500/20 text-emerald-800 in-[.dark]:text-emerald-400 border-emerald-500/30"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not configured</Badge>
                )}
              </div>
              <CardDescription>
                Forward notifications through a self-hosted{" "}
                <span className="font-medium">Apprise API</span> server or the local{" "}
                <span className="font-medium">Apprise CLI</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apprise-mode">Mode</Label>
                <Select
                  value={appriseMode}
                  onValueChange={(value) => {
                    if (value === "api" || value === "cli") setAppriseMode(value);
                  }}
                >
                  <SelectTrigger id="apprise-mode" className="w-full sm:w-56">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api">API</SelectItem>
                    <SelectItem value="cli">CLI</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  API mode sends notifications to a remote Apprise server. CLI mode runs the local{" "}
                  <code className="px-1">apprise</code> command inside Questarr.
                </p>
              </div>
              {appriseMode === "api" && (
                <div className="space-y-2">
                  <Label htmlFor="apprise-api-url">
                    API URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="apprise-api-url"
                    type="text"
                    placeholder="http://apprise:8000"
                    value={appriseApiUrl}
                    onChange={(e) => setAppriseApiUrl(e.target.value)}
                  />
                </div>
              )}
              {appriseMode === "api" && (
                <div className="space-y-2">
                  <Label htmlFor="apprise-key">
                    Config Key{" "}
                    <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="apprise-key"
                    type="text"
                    placeholder="my-config-key"
                    value={appriseKey}
                    onChange={(e) => setAppriseKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Persistent mode: a config key pre-configured in your Apprise API server.
                  </p>
                </div>
              )}
              {appriseMode === "api" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="apprise-username">
                      Username{" "}
                      <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="apprise-username"
                      type="text"
                      autoComplete="off"
                      value={appriseUsername}
                      onChange={(e) => setAppriseUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="apprise-password">
                      Password{" "}
                      <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="apprise-password"
                      type="password"
                      autoComplete="new-password"
                      value={apprisePassword}
                      onChange={(e) => setApprisePassword(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Only needed when your Apprise API server requires a login:{" "}
                    <code className="px-1">APPRISE_AUTH_REQUIRED=yes</code>.
                  </p>
                  {(appriseUsername.trim() || apprisePassword) && isHttpUrl(appriseApiUrl) && (
                    <p className="text-xs text-amber-700 in-[.dark]:text-amber-500 sm:col-span-2">
                      This API URL uses http://, so the login is sent unencrypted. Use https://
                      unless Apprise runs on a network you trust.
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="apprise-urls">
                  Notification URLs{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    {appriseMode === "cli" ? "(required)" : "(optional)"}
                  </span>
                </Label>
                <Textarea
                  id="apprise-urls"
                  placeholder={"discord://webhook/...\npushover://token@user/"}
                  value={appriseUrls}
                  onChange={(e) => setAppriseUrls(e.target.value)}
                  className="font-mono text-sm"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  One Apprise URL per line. Build URLs at{" "}
                  <a
                    href="https://appriseit.com/url-builder"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    appriseit.com/url-builder
                  </a>
                  .
                </p>
              </div>
              <div
                className="space-y-1 rounded-md border p-3 text-sm text-muted-foreground"
                data-testid="apprise-context-links-help"
              >
                <p className="font-medium text-foreground">Context links</p>
                {appriseSettings?.contextLinksEnabled ? (
                  <p>
                    Alerts tied to a page end with an &ldquo;Open in Questarr&rdquo; link (for
                    example the game&apos;s details page, where you can download). Error reports
                    have no page to link to.
                  </p>
                ) : (
                  <p>
                    Set the <code>APP_URL</code> environment variable (for example{" "}
                    <code>https://questarr.example.com</code>) to add an &ldquo;Open in
                    Questarr&rdquo; link to alerts that have a related page (error reports do not).
                  </p>
                )}
                <p>
                  The link is sent in the message body. Rich cards, buttons or link previews depend
                  on the target service: set them in its Apprise URL (for example{" "}
                  <code>format=markdown</code> for Telegram or Discord). See the{" "}
                  <a
                    href="https://github.com/caronc/apprise/wiki"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    Apprise service documentation
                  </a>
                  .
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() =>
                    updateAppriseMutation.mutate(
                      appriseMode === "cli"
                        ? { mode: appriseMode, urls: appriseUrls.trim() }
                        : {
                            mode: appriseMode,
                            apiUrl: appriseApiUrl.trim(),
                            key: appriseKey.trim(),
                            urls: appriseUrls.trim(),
                            username: appriseUsername.trim(),
                            password: apprisePassword,
                          }
                    )
                  }
                  disabled={appriseSaveDisabled}
                >
                  {updateAppriseMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testAppriseMutation.mutate()}
                  disabled={testAppriseMutation.isPending || !appriseSettings?.configured}
                >
                  {testAppriseMutation.isPending ? "Sending..." : "Send Test Notification"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <WebhookSubscriptionsCard />

          {/* Notification Preferences Card */}
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-lg">
                Notification Preferences
              </CardTitle>
              <CardDescription>
                Control which events create notifications and where they are sent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left text-sm font-medium text-muted-foreground pb-3 pr-2 sm:pr-4">
                        Event
                      </th>
                      <th className="text-center text-sm font-medium text-muted-foreground pb-3 px-3 sm:px-6 w-14 sm:w-24">
                        In-App
                      </th>
                      <th className="text-center text-sm font-medium text-muted-foreground pb-3 pl-3 sm:pl-6 w-14 sm:w-24">
                        Apprise
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {NOTIFICATION_EVENT_ROWS.map(({ key, label, group }, idx, arr) => {
                      const isGroupStart = idx > 0 && arr[idx - 1]!.group !== group;
                      return (
                        <tr
                          key={key}
                          className={`border-b last:border-0 ${isGroupStart ? "border-t-2 border-t-muted" : ""}`}
                        >
                          <td className="py-3 pr-2 sm:pr-4 text-sm">{label}</td>
                          <td className="py-3 px-3 sm:px-6 text-center">
                            <Switch
                              aria-label={`In-App: ${label}`}
                              checked={notifPrefs[key].inApp}
                              onCheckedChange={(checked) =>
                                handleNotifPrefChange(key, "inApp", checked)
                              }
                            />
                          </td>
                          <td className="py-3 pl-3 sm:pl-6 text-center">
                            <div
                              title={
                                !appriseSettings?.configured
                                  ? "Configure Apprise above to enable"
                                  : undefined
                              }
                            >
                              <Switch
                                aria-label={`Apprise: ${label}`}
                                checked={notifPrefs[key].apprise}
                                onCheckedChange={(checked) =>
                                  handleNotifPrefChange(key, "apprise", checked)
                                }
                                disabled={!appriseSettings?.configured}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 space-y-4 border-t pt-4">
                <div>
                  <h3 className="text-sm font-medium">Game updates and new packs/add-ons</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose whether shelved and completed games send these notifications. Applies to
                    both In-App and Apprise. Games are still checked for available content.
                  </p>
                </div>
                <SettingRow
                  id="notify-updates-shelved"
                  label="Notify for shelved games"
                  checked={notifPrefs.gameUpdates.includeShelved !== false}
                  onCheckedChange={(checked) =>
                    handleNotifPrefChange("gameUpdates", "includeShelved", checked)
                  }
                />
                <SettingRow
                  id="notify-updates-completed"
                  label="Notify for completed games"
                  checked={notifPrefs.gameUpdates.includeCompleted !== false}
                  onCheckedChange={(checked) =>
                    handleNotifPrefChange("gameUpdates", "includeCompleted", checked)
                  }
                />
              </div>
            </CardContent>
          </Card>
        </SettingsPanel>

        <SettingsPanel id="integrations" active={activeTab}>
          {/* IGDB Card */}
          <Card id="igdb-config">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <CardTitle as="h2" className="text-lg">
                    IGDB API
                  </CardTitle>
                  <IgdbHelpPopover />
                </div>
              </div>
              <CardDescription>Twitch/IGDB API integration for game metadata.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col space-y-2 pb-4 border-b">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Status</span>
                  {config?.igdb.configured ? (
                    <Badge variant={config.igdb.source === "database" ? "default" : "secondary"}>
                      {config.igdb.source === "database"
                        ? "Database (Active)"
                        : "Environment Variable"}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Not Configured</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Credentials configured here will override environment variables (IGDB_CLIENT_ID,
                  IGDB_CLIENT_SECRET).
                </p>
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="igdb-client-id">Client ID</Label>
                  <Input
                    id="igdb-client-id"
                    placeholder="Enter your IGDB Client ID"
                    value={igdbClientId}
                    onChange={(e) => setIgdbClientId(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="igdb-client-secret">Client Secret</Label>
                  <div className="relative">
                    <Input
                      id="igdb-client-secret"
                      type={showClientSecret ? "text" : "password"}
                      placeholder={
                        config?.igdb.configured ? "********" : "Enter your IGDB Client Secret"
                      }
                      value={igdbClientSecret}
                      onChange={(e) => setIgdbClientSecret(e.target.value)}
                      className="pr-10"
                    />
                    {igdbClientSecret && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        aria-label={showClientSecret ? "Hide client secret" : "Show client secret"}
                      >
                        {showClientSecret ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <IgdbTestConnectionButton
                clientId={igdbClientId}
                clientSecret={igdbClientSecret || (config?.igdb.configured ? "********" : "")}
                testEndpoint="/api/settings/igdb/test"
              />

              {/* Rate limit (formerly a standalone "Advanced" card) */}
              <div className="space-y-3 pt-4 border-t">
                <Label htmlFor="igdb-rate-limit" className="text-sm font-medium">
                  IGDB API Rate Limit (requests/second)
                </Label>
                <Input
                  id="igdb-rate-limit"
                  type="number"
                  min="1"
                  max="4"
                  value={igdbRateLimitPerSecond}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value);
                    setIgdbRateLimitPerSecond(
                      Number.isNaN(parsed) ? 3 : Math.min(4, Math.max(1, parsed))
                    );
                  }}
                  className="w-32"
                />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    <strong>IGDB allows 4 requests per second.</strong> Default is 3 to be
                    conservative.
                  </p>
                  <p>
                    Only increase if you experience slow loading times and are confident your usage
                    won&apos;t exceed the limit.
                  </p>
                  <p className="text-amber-700 in-[.dark]:text-amber-500">
                    Setting too high may result in API blacklisting.
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={handleSaveIgdb}
                  disabled={
                    updateIgdbMutation.isPending || updateAdvancedSettingsMutation.isPending
                  }
                  className="gap-2"
                >
                  {updateIgdbMutation.isPending || updateAdvancedSettingsMutation.isPending ? (
                    <span role="status" className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* API keys for external clients (Playnite extension, scripts) */}
          <ApiKeysCard />

          {/* Steam Integration Card */}
          <Card id="steam-config">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Steam Integration
                </CardTitle>
              </div>
              <CardDescription>Sync your Steam wishlist and import owned games.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="steam-api-key">Steam Web API key</Label>
                    {steamKeySettings?.apiKeyConfigured ? (
                      <Badge
                        variant={steamKeySettings.source === "database" ? "default" : "secondary"}
                      >
                        {steamKeySettings.source === "database"
                          ? "Saved here"
                          : "Environment variable"}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not configured</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="steam-api-key"
                        type={showSteamApiKey ? "text" : "password"}
                        autoComplete="off"
                        placeholder={
                          steamKeySettings?.apiKeyConfigured
                            ? "Enter a new key to replace the current one"
                            : "Enter your Steam Web API key"
                        }
                        value={steamApiKey}
                        onChange={(e) => setSteamApiKey(e.target.value)}
                        className="pr-10"
                      />
                      {steamApiKey && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowSteamApiKey(!showSteamApiKey)}
                          aria-label={showSteamApiKey ? "Hide API key" : "Show API key"}
                        >
                          {showSteamApiKey ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      )}
                    </div>
                    <Button
                      onClick={() => updateSteamKeyMutation.mutate(steamApiKey.trim())}
                      disabled={updateSteamKeyMutation.isPending || !steamApiKey.trim()}
                    >
                      {updateSteamKeyMutation.isPending ? "Saving..." : "Save key"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Needed to import your library, sync play time and show achievements. Get a key
                    on the{" "}
                    <a
                      href="https://steamcommunity.com/dev/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Steam Web API page
                    </a>
                    . It is stored encrypted and never shown again.
                    {steamKeySettings?.source === "env" && (
                      <span className="block mt-1">
                        A key is set through the <code>STEAM_API_KEY</code> environment variable.
                        Saving one here overrides it.
                      </span>
                    )}
                  </p>
                  {steamKeySettings?.source === "database" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateSteamKeyMutation.mutate("")}
                      disabled={updateSteamKeyMutation.isPending}
                    >
                      Remove the saved key
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="steam-id">Steam ID (64-bit)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="steam-id"
                      placeholder="76561198..."
                      value={steamIdInput}
                      onChange={(e) => setSteamIdInput(e.target.value)}
                    />
                    <Button
                      onClick={handleSaveSteamId}
                      disabled={updateSteamIdMutation.isPending || !steamIdInput.trim()}
                    >
                      {updateSteamIdMutation.isPending ? "Saving..." : "Save ID"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter your SteamID64 to sync your wishlist or import owned games. Find it on{" "}
                    <a
                      href="https://steamid.io"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      steamid.io
                    </a>
                  </p>
                </div>

                <SettingRow
                  id="steam-sync-enabled"
                  label="Auto-Sync Wishlist"
                  description="Periodically import new games from your Steam Wishlist"
                  className="pt-4 border-t"
                  checked={steamSyncEnabled}
                  onCheckedChange={setSteamSyncEnabled}
                />

                {steamSyncEnabled && (
                  <div className="space-y-2 pl-4 border-l-2">
                    <Label htmlFor="steam-sync-interval" className="text-sm font-medium">
                      Sync Interval (hours)
                    </Label>
                    <Input
                      id="steam-sync-interval"
                      type="number"
                      min="1"
                      max="168"
                      value={steamSyncIntervalHours}
                      onChange={(e) =>
                        setSteamSyncIntervalHours(
                          Math.min(168, Math.max(1, Number.parseInt(e.target.value) || 24))
                        )
                      }
                      className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                      How often to check your Steam Wishlist for new games (1-168 hours)
                    </p>
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t">
                  <UnsavedHint show={isSectionDirty("steam-sync")} />
                  <Button
                    onClick={handleSaveSteamSync}
                    disabled={settingsSavesInFlight > 0}
                    className="gap-2"
                  >
                    {isSectionSaving("steam-sync") ? (
                      <>
                        <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Save Sync Settings
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <SteamLibraryImport />

          <SteamPlaytimeSync />
          <SteamAchievementsSync />
          <RetroAchievementsSync />

          <PlayniteSyncStatus />

          {/* Nexus Mods Card */}
          <Card id="nexusmods-config">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <NexusModsIcon className="h-5 w-5 text-amber-500" aria-hidden="true" />
                  <CardTitle as="h2" className="text-lg">
                    Nexus Mods
                  </CardTitle>
                </div>
                {nexusmodsSettings?.configured ? (
                  <Badge
                    variant={nexusmodsSettings.source === "database" ? "default" : "secondary"}
                  >
                    {nexusmodsSettings.source === "database"
                      ? "Database (Active)"
                      : "Environment Variable"}
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Configured</Badge>
                )}
              </div>
              <CardDescription>
                Display trending mods and verify if your games have a Nexus Mods section.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nexus-api-key">Personal API Key</Label>
                <div className="relative">
                  <Input
                    id="nexus-api-key"
                    type={showNexusApiKey ? "text" : "password"}
                    placeholder={
                      nexusmodsSettings?.configured
                        ? "Enter a new key to override the current one"
                        : "Enter your Nexus Mods API key"
                    }
                    value={nexusApiKey}
                    onChange={(e) => setNexusApiKey(e.target.value)}
                    className="pr-10"
                  />
                  {nexusApiKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowNexusApiKey(!showNexusApiKey)}
                      aria-label={showNexusApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showNexusApiKey ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your personal API key on the{" "}
                  <a
                    href="https://www.nexusmods.com/users/myaccount?tab=api"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Nexus Mods account page
                  </a>
                  . Rate limits: 500 req/hour, 20,000 req/day.
                  {nexusmodsSettings?.source === "env" && (
                    <span className="block mt-1">
                      A key is configured via the <code>NEXUSMODS_API_KEY</code> environment
                      variable. Saving a key here will override it.
                    </span>
                  )}
                </p>
              </div>
              <div className="flex justify-end pt-2 border-t">
                <Button
                  onClick={handleSaveNexus}
                  disabled={updateNexusMutation.isPending || !nexusApiKey.trim()}
                  className="gap-2"
                >
                  {updateNexusMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      Save API Key
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* TypeSafe (Jev) AI Card */}
          <Card id="typesafe-config">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Sparkles className="h-5 w-5 shrink-0 text-blue-500" />
                  <CardTitle as="h2" className="text-lg">
                    AI Release Analysis (TypeSafe)
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-600/50 text-amber-700 in-[.dark]:border-amber-500/50 in-[.dark]:text-amber-500"
                    title="Experimental feature: behavior and results may change between releases"
                  >
                    <FlaskConical className="h-3 w-3" aria-hidden="true" />
                    Experimental
                  </Badge>
                </div>
                {typesafeSettings?.configured ? (
                  <Badge variant="default">Enabled</Badge>
                ) : (
                  <Badge variant="outline">Not Configured</Badge>
                )}
              </div>
              <CardDescription>
                Optional. Uses TypeSafe&apos;s Jev model to classify release types (full game, DLC,
                update, repack...) and flag suspiciously small files in search results. Entirely
                optional and off by default &mdash; Questarr works normally without it. Bring your
                own API key and endpoint (TypeSafe, OpenRouter, a self-hosted proxy, etc.).{" "}
                <span className="mt-2 block text-amber-700 in-[.dark]:text-amber-500">
                  Experimental: Jev classifications can be wrong, and how they are used may change
                  between releases. Check flagged results before relying on them.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="typesafe-api-url">API URL</Label>
                <Input
                  id="typesafe-api-url"
                  type="text"
                  placeholder="https://api.typesafe.ai/v1/systemone"
                  value={typesafeApiUrl}
                  onChange={(e) => setTypesafeApiUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use TypeSafe&apos;s default endpoint.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="typesafe-api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="typesafe-api-key"
                    type={showTypesafeApiKey ? "text" : "password"}
                    placeholder={
                      typesafeSettings?.configured
                        ? "Enter a new key to override the current one"
                        : "Enter your API key"
                    }
                    value={typesafeApiKey}
                    onChange={(e) => setTypesafeApiKey(e.target.value)}
                    className="pr-10"
                  />
                  {typesafeApiKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowTypesafeApiKey(!showTypesafeApiKey)}
                      aria-label={showTypesafeApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showTypesafeApiKey ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="typesafe-model">Model</Label>
                <Input
                  id="typesafe-model"
                  type="text"
                  placeholder="jev-latest"
                  value={typesafeModel}
                  onChange={(e) => setTypesafeModel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for TypeSafe&apos;s default model. Routing through OpenRouter? Set the
                  API URL to{" "}
                  <code className="text-[10px]">https://openrouter.ai/api/alpha/decisions</code> and
                  the model to <code className="text-[10px]">typesafe/jev-1.13</code>.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                {typesafeSettings?.configured && (
                  <Button
                    variant="outline"
                    onClick={() => clearTypesafeMutation.mutate()}
                    disabled={clearTypesafeMutation.isPending}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Disable
                  </Button>
                )}
                <Button
                  onClick={handleSaveTypesafe}
                  disabled={
                    updateTypesafeMutation.isPending ||
                    (!typesafeApiKey.trim() && !typesafeSettings?.configured)
                  }
                  className="gap-2"
                >
                  {updateTypesafeMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      Save API Key
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* xREL.to Search Options */}
          <Card id="xrel-settings">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Newspaper className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  xREL.to
                </CardTitle>
              </div>
              <CardDescription>
                Alert when a wanted game appears on xREL.to (scene/P2P release list). API base URL
                and search options for the auto-check.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="xrel-api-base" className="text-sm font-medium">
                    API base URL
                  </Label>
                  <Select value={xrelApiBase} onValueChange={setXrelApiBase}>
                    <SelectTrigger id="xrel-api-base" className="w-full font-mono text-sm">
                      <SelectValue placeholder="Select API base URL" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https://xrel-api.nfos.to">
                        https://xrel-api.nfos.to (Mirror - Recommended)
                      </SelectItem>
                      <SelectItem value="https://api.xrel.to">
                        https://api.xrel.to (Official - Often blocked)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Use the mirror if your IP is blocked by Cloudflare on the official API.
                  </p>
                </div>
                <SettingRow
                  id="xrel-scene"
                  label="Include scene releases"
                  description="Search scene releases when checking for wanted games on xREL.to"
                  checked={xrelSceneReleases}
                  onCheckedChange={setXrelSceneReleases}
                />
                <SettingRow
                  id="xrel-p2p"
                  label="Include P2P releases"
                  description="Search P2P releases when checking for wanted games on xREL.to"
                  checked={xrelP2pReleases}
                  onCheckedChange={setXrelP2pReleases}
                />
              </div>
              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={handleSaveXrel}
                  disabled={saveXrelMutation.isPending}
                  className="gap-2"
                >
                  {saveXrelMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Newspaper className="h-4 w-4" />
                      Save xREL.to options
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </SettingsPanel>

        <SettingsPanel id="import" active={activeTab}>
          <ImportSettings />
        </SettingsPanel>

        <SettingsPanel id="system" active={activeTab}>
          {/* Application Management */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Maintenance
                </CardTitle>
              </div>
              <CardDescription>Application maintenance and data management tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Clear Downloads Cache</p>
                    <p className="text-xs text-muted-foreground">
                      Clear cached torrent/NZB search results so the next search fetches fresh data
                      from all configured indexers.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      clearSearchCache();
                      toast({
                        title: "Downloads Cache Cleared",
                        description:
                          "Search results cache has been cleared. New searches will fetch fresh data.",
                      });
                    }}
                    className="gap-2 w-full sm:w-auto shrink-0"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Clear Cache
                  </Button>
                </div>
              </div>
              <div className="flex flex-col space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Refresh Metadata</p>
                    <p className="text-xs text-muted-foreground">
                      Update all games in your library with the latest information from IGDB.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refreshMetadataMutation.mutate()}
                    disabled={refreshMetadataMutation.isPending}
                    className="gap-2 w-full sm:w-auto shrink-0"
                  >
                    {refreshMetadataMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Refresh All
                  </Button>
                </div>
              </div>
              <div className="flex flex-col space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Check Library Health</p>
                    <p className="text-xs text-muted-foreground">
                      Find games whose library files have gone missing, and library folders that no
                      longer match any game.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => libraryHealthMutation.mutate()}
                    disabled={libraryHealthMutation.isPending}
                    className="gap-2 w-full sm:w-auto shrink-0"
                  >
                    {libraryHealthMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Check Library
                  </Button>
                </div>
                {libraryHealthResult &&
                  (libraryHealthResult.drifted.length > 0 ||
                    libraryHealthResult.orphaned.length > 0) && (
                    <div className="mt-2 space-y-3 rounded-md border border-border p-3 text-xs">
                      {libraryHealthResult.drifted.length > 0 && (
                        <div>
                          <p className="font-medium text-amber-700 in-[.dark]:text-amber-500">
                            Drifted ({libraryHealthResult.drifted.length})
                          </p>
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            {libraryHealthResult.drifted.map((g) => (
                              <li key={g.id}>
                                {g.title} — {g.libraryPath}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {libraryHealthResult.orphaned.length > 0 && (
                        <div>
                          <p className="font-medium text-amber-700 in-[.dark]:text-amber-500">
                            Orphaned ({libraryHealthResult.orphaned.length})
                          </p>
                          <ul className="mt-1 space-y-1 text-muted-foreground">
                            {libraryHealthResult.orphaned.map((o) => (
                              <li key={o.path}>{o.path}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </CardContent>
          </Card>

          {/* Telemetry */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Radio className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Telemetry
                </CardTitle>
              </div>
              <CardDescription>
                Help improve Questarr by automatically sharing diagnostic data when something goes
                wrong
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <SettingRow
                id="telemetry-enabled"
                label="Automatically send error reports"
                description={`Off by default. When Questarr detects an unexpected server error, it will normally ask you first (see the "Error Detected" event in Settings > Notifications). Turn this on to skip that prompt and send a scrubbed diagnostic report automatically instead — no personal data, IP addresses, or file paths are included. Reports help the maintainer catch bugs users don't otherwise report. You can still send a one-off report manually from the Logs page at any time, whatever this setting is.`}
                checked={telemetryEnabled}
                onCheckedChange={setTelemetryEnabled}
              />
              <div className="flex justify-end pt-4 border-t">
                <UnsavedHint show={isSectionDirty("telemetry")} />
                <Button
                  onClick={handleSaveTelemetry}
                  disabled={settingsSavesInFlight > 0}
                  className="gap-2"
                >
                  {isSectionSaving("telemetry") ? (
                    <>
                      <RefreshCw className="h-4 w-4 motion-safe:animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Radio className="h-4 w-4" />
                      Save Telemetry
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Downloader Debug Logging */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  Downloader Debug Logging
                </CardTitle>
              </div>
              <CardDescription>
                Log downloader response status, headers, and body (up to 10KB) from download clients
                (qBittorrent, Transmission, rTorrent, Deluge, Synology Download Station, sabnzbd,
                nzbget) at debug level. Response headers and bodies can contain sensitive data -
                enable this only while debugging and review logs carefully. Useful when diagnosing
                why a download isn&apos;t being added or tracked correctly - leave this off
                otherwise, as it can be noisy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SettingRow
                id="downloader-debug-logging"
                label="Log full downloader responses"
                description="Applies immediately and affects all configured downloaders. View the results on the Logs page."
                extra={
                  isDownloaderDebugLoggingError && (
                    <span className="block text-xs text-destructive">
                      Failed to load the current setting. Refresh the page to try again.
                    </span>
                  )
                }
                checked={downloaderDebugLogging?.enabled ?? false}
                disabled={
                  isDownloaderDebugLoggingLoading ||
                  isDownloaderDebugLoggingError ||
                  updateDownloaderDebugLoggingMutation.isPending
                }
                onCheckedChange={(checked) => updateDownloaderDebugLoggingMutation.mutate(checked)}
              />
            </CardContent>
          </Card>
        </SettingsPanel>

        <SettingsPanel id="account-security" active={activeTab}>
          <PasswordSettings />

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <CardTitle as="h2" className="text-lg">
                  SSL/HTTPS Configuration
                </CardTitle>
              </div>
              <CardDescription>
                Configure secure access to Questarr. Requires server restart to apply changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {sslSettings && (
                <>
                  <SettingRow
                    id="ssl-enabled"
                    label="Enable SSL"
                    description="Turn on HTTPS support"
                    checked={sslEnabled}
                    onCheckedChange={setSslEnabled}
                  />

                  {sslEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="ssl-port">SSL Port</Label>
                        <Input
                          id="ssl-port"
                          type="number"
                          value={sslPort}
                          disabled
                          className="w-32 bg-muted"
                        />
                        <p className="text-xs text-muted-foreground">
                          Configured via SSL_PORT environment variable (e.g., in docker-compose.yml)
                          - Default: 9898
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="cert-path">Certificate Path (.crt/.pem)</Label>
                        <div className="flex gap-2">
                          <Input
                            id="cert-path"
                            value={sslCertPath}
                            onChange={(e) => setSslCertPath(e.target.value)}
                            placeholder="/path/to/server.crt"
                          />
                          <Button variant="outline" onClick={() => setIsCertBrowserOpen(true)}>
                            Browse
                          </Button>
                        </div>
                        <PathBrowser
                          isOpen={isCertBrowserOpen}
                          onClose={() => setIsCertBrowserOpen(false)}
                          onSelect={(path) => setSslCertPath(path)}
                          initialPath={sslCertPath}
                          title="Select Certificate File"
                          extensions={[".crt", ".pem", ".cer"]}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="key-path">Private Key Path (.key)</Label>
                        <div className="flex gap-2">
                          <Input
                            id="key-path"
                            value={sslKeyPath}
                            onChange={(e) => setSslKeyPath(e.target.value)}
                            placeholder="/path/to/server.key"
                          />
                          <Button variant="outline" onClick={() => setIsKeyBrowserOpen(true)}>
                            Browse
                          </Button>
                        </div>
                        <PathBrowser
                          isOpen={isKeyBrowserOpen}
                          onClose={() => setIsKeyBrowserOpen(false)}
                          onSelect={(path) => setSslKeyPath(path)}
                          initialPath={sslKeyPath}
                          title="Select Private Key File"
                          extensions={[".key", ".pem"]}
                        />
                      </div>

                      <div className="space-y-4">
                        <SettingRow
                          id="ssl-redirect"
                          label="Force HTTPS"
                          description="Redirect all HTTP traffic to HTTPS"
                          checked={sslRedirectHttp}
                          onCheckedChange={setSslRedirectHttp}
                        />

                        {sslRedirectHttp && (
                          <Alert className="border-orange-500/50 bg-orange-500/10">
                            <AlertCircle className="h-4 w-4 text-orange-700 in-[.dark]:text-orange-500" />
                            <AlertTitle>HTTP Port Will Be Disabled</AlertTitle>
                            <AlertDescription>
                              When HTTPS redirect is enabled, the HTTP port will be disabled on the
                              next server restart. Make sure you can access the server via HTTPS
                              before restarting to avoid losing access.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>

                      <div className="pt-4 border-t">
                        <h4 className="text-sm font-medium mb-4">Certificate Status</h4>

                        {certInfo ? (
                          <div className="rounded-md border bg-card text-card-foreground shadow-sm mb-6 p-4 space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                              {certInfo.valid ? (
                                <ShieldCheck className="h-5 w-5 text-green-500" />
                              ) : (
                                <ShieldAlert className="h-5 w-5 text-red-500" />
                              )}
                              <span className="font-semibold">
                                {certInfo.selfSigned
                                  ? "Self-Signed Certificate"
                                  : "Valid Certificate"}
                              </span>
                            </div>

                            <div className="grid gap-1 text-sm text-muted-foreground">
                              <div className="flex justify-between">
                                <span>Issued To:</span>
                                <span className="font-mono text-xs">
                                  {certInfo.subject ? certInfo.subject.split(",")[0] : "Unknown"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Issued By:</span>
                                <span className="font-mono text-xs">
                                  {certInfo.issuer ? certInfo.issuer.split(",")[0] : "Unknown"}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  <span>Valid Until:</span>
                                </div>
                                <span>
                                  {certInfo.validTo
                                    ? new Date(certInfo.validTo).toLocaleDateString()
                                    : "Unknown"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mb-4">
                            No valid certificate information found.
                          </p>
                        )}

                        <div className="space-y-4">
                          {certInfo?.selfSigned ? (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">
                                You are using a self-signed certificate. You can renew it if it's
                                expired or about to expire.
                              </p>
                              <Button
                                variant="outline"
                                onClick={() => generateCertMutation.mutate()}
                                disabled={generateCertMutation.isPending}
                              >
                                {generateCertMutation.isPending
                                  ? "Renewing..."
                                  : "Renew Self-Signed Certificate"}
                              </Button>
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">
                                Generate a self-signed certificate if you don't have one.
                                <br />
                                <span className="text-amber-700 in-[.dark]:text-amber-500 font-semibold">
                                  Warning:
                                </span>{" "}
                                Browsers will show a security warning for self-signed certificates.
                              </p>
                              <Button
                                variant="outline"
                                onClick={() => generateCertMutation.mutate()}
                                disabled={
                                  generateCertMutation.isPending ||
                                  (!!certInfo && !certInfo.selfSigned)
                                }
                              >
                                {generateCertMutation.isPending
                                  ? "Generating..."
                                  : "Generate Self-Signed Certificate"}
                              </Button>
                              {!!certInfo && !certInfo.selfSigned && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Certificate generation disabled because a non-self-signed
                                  certificate is detected.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t space-y-4">
                        <h4 className="text-sm font-medium">Upload Certificate</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="cert-upload">Certificate File (.crt/.pem)</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="cert-upload"
                                type="file"
                                accept=".crt,.pem,.cer"
                                className="hidden"
                                ref={certInputRef}
                                onChange={(e) => setSelectedCert(e.target.files?.[0] || null)}
                              />
                              <Label
                                htmlFor="cert-upload"
                                className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${selectedCert ? "text-primary border-primary" : "text-muted-foreground"}`}
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                {selectedCert ? selectedCert.name : "Select Certificate File"}
                              </Label>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="key-upload">Private Key File (.key/.pem)</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="key-upload"
                                type="file"
                                accept=".key,.pem"
                                className="hidden"
                                ref={keyInputRef}
                                onChange={(e) => setSelectedKey(e.target.files?.[0] || null)}
                              />
                              <Label
                                htmlFor="key-upload"
                                className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${selectedKey ? "text-primary border-primary" : "text-muted-foreground"}`}
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                {selectedKey ? selectedKey.name : "Select Private Key File"}
                              </Label>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => uploadCertMutation.mutate()}
                          disabled={!selectedCert || !selectedKey || uploadCertMutation.isPending}
                        >
                          {uploadCertMutation.isPending
                            ? "Uploading..."
                            : "Upload Certificate & Key"}
                        </Button>
                      </div>
                    </>
                  )}

                  <div className="flex justify-end pt-4 border-t">
                    <Button onClick={handleSaveSsl} disabled={updateSslMutation.isPending}>
                      {updateSslMutation.isPending ? "Saving..." : "Save SSL Settings"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </SettingsPanel>
      </div>
    </div>
  );
}
