import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingRow } from "@/components/ui/setting-row";
import { useToast } from "@/hooks/use-toast";
import { withBasePath } from "@/lib/app-path";
import { apiRequest } from "@/lib/queryClient";
import { IgdbHelpPopover, IgdbTestConnectionButton } from "@/components/IgdbCredentialsHelper";
import PlatformsSettings from "@/components/PlatformsSettings";
import ImportSettings from "@/components/ImportSettings";
import { RetroAchievementsSync } from "@/components/RetroAchievementsSync";
import { XboxAchievementsSync } from "@/components/XboxAchievementsSync";
import { PsnAchievementsSync } from "@/components/PsnAchievementsSync";
import {
  WIZARD_PLATFORMS,
  type WizardAnswers,
  type WizardPlatform,
  type WizardStepId,
} from "@shared/setup-wizard";
import type { WizardStatus } from "./use-wizard-status";

const PLATFORM_LABELS: Record<WizardPlatform, { label: string; hint: string }> = {
  pc: { label: "PC", hint: "Steam, GOG, Epic and others" },
  xbox: { label: "Xbox", hint: "Console or Xbox app" },
  playstation: { label: "PlayStation", hint: "PS3 to PS5" },
  nintendo: { label: "Nintendo", hint: "Switch and older" },
  retro: { label: "Retro and emulation", hint: "Consoles from the 80s to the 2000s" },
};

export interface StepProps {
  answers: WizardAnswers;
  status: WizardStatus;
}

/** Queries other pages read the saved settings from, so they do not serve a stale answer. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (...keys: string[]) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
  };
}

function useSaveError() {
  const { toast } = useToast();
  return (error: Error) =>
    toast({ title: "Could not save", description: error.message, variant: "destructive" });
}

/** Save part of the account settings (`PATCH /api/settings`) and refresh them. */
function useSettingsPatch<T extends object>() {
  const queryClient = useQueryClient();
  const onError = useSaveError();
  const { data } = useQuery<T>({ queryKey: ["/api/settings"] });
  const patch = useMutation({
    mutationFn: async (update: Partial<T>) =>
      (await apiRequest("PATCH", "/api/settings", update)).json(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError,
  });
  return { data, patch };
}

/** A secret field with its own Save button, for a key saved through one endpoint. */
function SecretKeyField({
  id,
  label,
  endpoint,
  toastTitle,
  status,
  help,
}: Readonly<{
  id: string;
  label: string;
  endpoint: string;
  toastTitle: string;
  status: WizardStatus;
  help: { href: string; text: string };
}>) {
  const { toast } = useToast();
  const onError = useSaveError();
  const invalidate = useInvalidate();
  const [apiKey, setApiKey] = useState("");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", endpoint, { apiKey: apiKey.trim() })).json(),
    onSuccess: () => {
      toast({ title: toastTitle });
      setApiKey("");
      invalidate(endpoint, "/api/steam/playtime", "/api/steam/achievements");
      status.refresh();
    },
    onError,
  });
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending || !apiKey.trim()}>
          Save
        </Button>
      </div>
      <a
        className="text-xs text-primary underline"
        href={help.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {help.text}
      </a>
    </div>
  );
}

function StepSection({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="space-y-4">{children}</div>;
}

/** A page of Settings, opened beside the wizard so no answer is lost. */
function OpenInSettings({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Button variant="outline" asChild className="gap-2">
      <a href={withBasePath(href)} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </Button>
  );
}

export function ConfiguredBadge({ configured }: Readonly<{ configured: boolean }>) {
  return configured ? <Badge>Configured</Badge> : <Badge variant="outline">Not configured</Badge>;
}

// --- Questions -------------------------------------------------------------

export function QuestionsStep({
  answers,
  onChange,
}: Readonly<{ answers: WizardAnswers; onChange: (next: WizardAnswers) => void }>) {
  const togglePlatform = (platform: WizardPlatform, checked: boolean) => {
    const platforms = checked
      ? [...answers.platforms, platform]
      : answers.platforms.filter((p) => p !== platform);
    onChange({ ...answers, platforms });
  };
  return (
    <StepSection>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Which platforms do you manage games for?</legend>
        <p className="text-sm text-muted-foreground">
          This decides which services are offered next, for example achievements or trophies.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {WIZARD_PLATFORMS.map((platform) => {
            const id = `wizard-platform-${platform}`;
            return (
              <label
                key={platform}
                htmlFor={id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3"
              >
                <Checkbox
                  id={id}
                  checked={answers.platforms.includes(platform)}
                  onCheckedChange={(checked) => togglePlatform(platform, checked === true)}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium leading-none">
                    {PLATFORM_LABELS[platform].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {PLATFORM_LABELS[platform].hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SettingRow
        id="wizard-download"
        label="Let Questarr search for and download games"
        description="Off if you only want to track your library and wishlist. Indexers, download clients and import settings are skipped."
        checked={answers.download}
        onCheckedChange={(download) => onChange({ ...answers, download })}
      />
      <SettingRow
        id="wizard-notifications"
        label="Send me notifications outside the app"
        description="Alerts through Apprise (email, Telegram, Discord and more)."
        checked={answers.notifications}
        onCheckedChange={(notifications) => onChange({ ...answers, notifications })}
      />
    </StepSection>
  );
}

// --- IGDB -----------------------------------------------------------------

export function IgdbStep({ status }: Readonly<StepProps>) {
  const { toast } = useToast();
  const onError = useSaveError();
  const invalidate = useInvalidate();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const configured = Boolean(status.configured.igdb);
  const save = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/settings/igdb", { clientId, clientSecret })).json(),
    onSuccess: () => {
      toast({ title: "IGDB credentials saved" });
      setClientSecret("");
      invalidate("/api/config", "/api/settings/igdb");
      status.refresh();
    },
    onError,
  });
  return (
    <StepSection>
      <div className="flex items-center gap-2">
        <ConfiguredBadge configured={configured} />
        <IgdbHelpPopover />
      </div>
      <p className="text-sm text-muted-foreground">
        Questarr gets covers, descriptions and release dates from IGDB, through a free Twitch
        developer application.
        {configured && " Credentials are already in place; fill the fields only to replace them."}
      </p>
      <div className="space-y-2">
        <Label htmlFor="wizard-igdb-id">Client ID</Label>
        <Input
          id="wizard-igdb-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wizard-igdb-secret">Client Secret</Label>
        <Input
          id="wizard-igdb-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <IgdbTestConnectionButton
          clientId={clientId}
          clientSecret={clientSecret}
          testEndpoint="/api/settings/igdb/test"
        />
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !clientId.trim() || !clientSecret.trim()}
        >
          Save credentials
        </Button>
      </div>
    </StepSection>
  );
}

// --- Platforms, import (existing cards) -----------------------------------------

export function PlatformsStep() {
  return <PlatformsSettings />;
}

export function ImportStep() {
  return <ImportSettings />;
}

// --- Link-out steps ------------------------------------------------------------

function LinkOutStep({
  configured,
  detail,
  help,
  href,
  label,
  status,
}: Readonly<{
  configured: boolean;
  detail: string;
  help: string;
  href: string;
  label: string;
  status: WizardStatus;
}>) {
  return (
    <StepSection>
      <div className="flex items-center gap-2">
        <ConfiguredBadge configured={configured} />
        <span className="text-sm text-muted-foreground">{detail}</span>
      </div>
      <p className="text-sm text-muted-foreground">{help}</p>
      <div className="flex flex-wrap gap-2">
        <OpenInSettings href={href} label={label} />
        <Button variant="ghost" className="gap-2" onClick={status.refresh}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Check again
        </Button>
      </div>
    </StepSection>
  );
}

export function IndexersStep({ status }: Readonly<StepProps>) {
  return (
    <LinkOutStep
      status={status}
      configured={status.indexerCount > 0}
      detail={`${status.indexerCount} indexer${status.indexerCount === 1 ? "" : "s"}`}
      help="Add a Torznab or Newznab indexer, or import your indexers from Prowlarr in one go. It opens in a new tab: come back here and press Check again."
      href="/indexers"
      label="Open Indexers"
    />
  );
}

export function DownloadersStep({ status }: Readonly<StepProps>) {
  return (
    <LinkOutStep
      status={status}
      configured={status.downloaderCount > 0}
      detail={`${status.downloaderCount} download client${status.downloaderCount === 1 ? "" : "s"}`}
      help="Connect qBittorrent, Transmission, rTorrent, SABnzbd or NZBGet. It opens in a new tab: come back here and press Check again."
      href="/downloaders"
      label="Open Download clients"
    />
  );
}

export function NotificationsStep({ status }: Readonly<StepProps>) {
  return (
    <LinkOutStep
      status={status}
      configured={Boolean(status.configured.notifications)}
      detail="Apprise"
      help="Point Questarr at your Apprise server and choose which events notify you."
      href="/settings/notifications"
      label="Open Notification settings"
    />
  );
}

// --- Automation ----------------------------------------------------------------

interface AutomationSettings {
  autoSearchEnabled: boolean;
  autoDownloadEnabled: boolean;
  searchIntervalHours: number;
}

export function AutomationStep() {
  const { data, patch } = useSettingsPatch<AutomationSettings>();
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <StepSection>
      <SettingRow
        id="wizard-auto-search"
        label="Search for wanted games automatically"
        description="Questarr checks your indexers on a schedule and flags new releases."
        checked={data.autoSearchEnabled}
        onCheckedChange={(autoSearchEnabled) => patch.mutate({ autoSearchEnabled })}
      />
      <div className="space-y-2">
        <Label htmlFor="wizard-search-interval">Search every (hours)</Label>
        <Input
          id="wizard-search-interval"
          type="number"
          min={1}
          max={168}
          className="w-32"
          defaultValue={data.searchIntervalHours}
          onBlur={(e) => {
            const hours = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(hours) && hours >= 1 && hours <= 168) {
              patch.mutate({ searchIntervalHours: hours });
            }
          }}
        />
      </div>
      <SettingRow
        id="wizard-auto-download"
        label="Download the best release without asking"
        description="Leave off to review releases yourself before anything is downloaded."
        checked={data.autoDownloadEnabled}
        onCheckedChange={(autoDownloadEnabled) => patch.mutate({ autoDownloadEnabled })}
      />
    </StepSection>
  );
}

// --- Steam ----------------------------------------------------------------------

export function SteamStep({ status }: Readonly<StepProps>) {
  const { toast } = useToast();
  const onError = useSaveError();
  const invalidate = useInvalidate();
  const [steamId, setSteamId] = useState("");
  const saveId = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", "/api/user/steam-id", { steamId: steamId.trim() })).json(),
    onSuccess: () => {
      toast({ title: "Steam ID saved" });
      invalidate("/api/auth/me", "/api/steam/achievements", "/api/achievements/progress");
      status.refresh();
    },
    onError,
  });
  return (
    <StepSection>
      <ConfiguredBadge configured={Boolean(status.configured.steam)} />
      <p className="text-sm text-muted-foreground">
        With a Steam Web API key and your 64-bit Steam ID, Questarr can import your library and
        wishlist and track playtime and achievements. Your Steam profile must be public.
      </p>
      <SecretKeyField
        id="wizard-steam-key"
        label="Steam Web API key"
        endpoint="/api/settings/steam"
        toastTitle="Steam API key saved"
        status={status}
        help={{
          href: "https://steamcommunity.com/dev/apikey",
          text: "Get a key on steamcommunity.com",
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="wizard-steam-id">Steam ID (64-bit)</Label>
        <div className="flex gap-2">
          <Input
            id="wizard-steam-id"
            inputMode="numeric"
            placeholder="7656…"
            value={steamId}
            onChange={(e) => setSteamId(e.target.value)}
          />
          <Button onClick={() => saveId.mutate()} disabled={saveId.isPending || !steamId.trim()}>
            Save
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Importing the library and turning on playtime or achievement sync is done from Settings &gt;
        Connections once the key and ID are saved.
      </p>
    </StepSection>
  );
}

// --- RetroAchievements -------------------------------------------------------------

export function RetroAchievementsStep() {
  return (
    <StepSection>
      <p className="text-sm text-muted-foreground">
        Add your RetroAchievements username and Web API key to follow your unlocks next to your
        retro games.
      </p>
      <RetroAchievementsSync />
    </StepSection>
  );
}

// --- Xbox and PlayStation ----------------------------------------------------------

export function XboxStep() {
  return (
    <StepSection>
      <p className="text-sm text-muted-foreground">
        Add an OpenXBL key to follow your Xbox achievements next to your games.
      </p>
      <XboxAchievementsSync />
    </StepSection>
  );
}

export function PsnStep() {
  return (
    <StepSection>
      <p className="text-sm text-muted-foreground">
        Add your PlayStation NPSSO token to follow your trophies next to your games.
      </p>
      <PsnAchievementsSync />
    </StepSection>
  );
}

// --- NexusMods ---------------------------------------------------------------------

export function NexusModsStep({ status }: Readonly<StepProps>) {
  return (
    <StepSection>
      <ConfiguredBadge configured={Boolean(status.configured.nexusmods)} />
      <p className="text-sm text-muted-foreground">
        A personal NexusMods API key lets game pages show popular and trending mods.
      </p>
      <SecretKeyField
        id="wizard-nexus-key"
        label="Personal API key"
        endpoint="/api/settings/nexusmods"
        toastTitle="NexusMods key saved"
        status={status}
        help={{
          href: "https://www.nexusmods.com/users/myaccount?tab=api",
          text: "Get a key on nexusmods.com",
        }}
      />
    </StepSection>
  );
}

// --- Quests and diagnostics -------------------------------------------------------------

interface PrivacySettings {
  questsEnabled: boolean;
  telemetryEnabled: boolean;
}

export function PrivacyStep() {
  const { data, patch } = useSettingsPatch<PrivacySettings>();
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <StepSection>
      <SettingRow
        id="wizard-quests"
        label="Backlog quests and medals"
        description="Small goals that nudge you through your backlog. Turn off if you find them noisy."
        checked={data.questsEnabled}
        onCheckedChange={(questsEnabled) => patch.mutate({ questsEnabled })}
      />
      <SettingRow
        id="wizard-telemetry"
        label="Send error reports automatically"
        description="Off by default. When on, server errors are sent as an anonymised diagnostic report."
        checked={data.telemetryEnabled}
        onCheckedChange={(telemetryEnabled) => patch.mutate({ telemetryEnabled })}
      />
    </StepSection>
  );
}

/** Steps whose body needs no more than the answers and the status. */
export type StepRenderer = (props: StepProps) => ReactNode;

export const STEP_RENDERERS: Partial<Record<WizardStepId, StepRenderer>> = {
  igdb: (p) => <IgdbStep {...p} />,
  platforms: () => <PlatformsStep />,
  indexers: (p) => <IndexersStep {...p} />,
  downloaders: (p) => <DownloadersStep {...p} />,
  automation: () => <AutomationStep />,
  import: () => <ImportStep />,
  steam: (p) => <SteamStep {...p} />,
  retroachievements: () => <RetroAchievementsStep />,
  xbox: () => <XboxStep />,
  psn: () => <PsnStep />,
  nexusmods: (p) => <NexusModsStep {...p} />,
  notifications: (p) => <NotificationsStep {...p} />,
  privacy: () => <PrivacyStep />,
};
