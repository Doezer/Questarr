/**
 * Setup wizard: which steps to show, given what the person said they use.
 *
 * Pure and dependency-free on purpose: the client renders the result, and the tests pin the
 * conditional logic without a browser. A step is shown when its `when` rule matches the answers;
 * with "only what is not configured yet" (the default for installs that predate the wizard),
 * steps whose settings are already in place are left out as well.
 */

export const WIZARD_PLATFORMS = ["pc", "xbox", "playstation", "nintendo", "retro"] as const;
export type WizardPlatform = (typeof WIZARD_PLATFORMS)[number];

export const WIZARD_NOTIFICATION_CHANNELS = ["apprise"] as const;
export type WizardNotificationChannel = (typeof WIZARD_NOTIFICATION_CHANNELS)[number];

export interface WizardAnswers {
  /** Where the person plays: drives which library and achievement services are offered. */
  platforms: WizardPlatform[];
  /** Whether Questarr should search for and download games, or only track them. */
  download: boolean;
  /** Whether they want alerts pushed to them (Apprise). */
  notifications: boolean;
}

export const DEFAULT_WIZARD_ANSWERS: WizardAnswers = {
  platforms: [],
  download: false,
  notifications: false,
};

export type WizardStepId =
  | "questions"
  | "igdb"
  | "platforms"
  | "indexers"
  | "downloaders"
  | "automation"
  | "import"
  | "steam"
  | "retroachievements"
  | "xbox"
  | "psn"
  | "nexusmods"
  | "notifications"
  | "privacy"
  | "summary";

/** Configuration facts the wizard looks up so it can skip what is already set. */
export type WizardConfigured = Partial<Record<WizardStepId, boolean>>;

export interface WizardStepDef {
  id: WizardStepId;
  title: string;
  /** One line shown in the progress list and the summary. */
  summary: string;
  /** Shown only when this returns true. */
  when: (answers: WizardAnswers) => boolean;
  /** Questions and summary are never skipped as "already configured". */
  alwaysShown: boolean;
  /** The wizard revision that introduced this step (see `WIZARD_REVISION`). */
  since: number;
}

const always = () => true;
const plays = (platform: WizardPlatform) => (a: WizardAnswers) => a.platforms.includes(platform);

function step(
  id: WizardStepId,
  title: string,
  summary: string,
  when: WizardStepDef["when"],
  alwaysShown = false,
  since = 1
): WizardStepDef {
  return { id, title, summary, when, alwaysShown, since };
}

const hasDownload = (a: WizardAnswers) => a.download;

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  step("questions", "About your setup", "Where you play and what Questarr should do", always, true),
  step("igdb", "Game database (IGDB)", "Credentials used to find metadata and covers", always),
  step("platforms", "Platforms", "Limit filters and imports to the ones you use", always),
  step("indexers", "Indexers", "Where Questarr looks for releases", hasDownload),
  step("downloaders", "Download clients", "The client that fetches releases", hasDownload),
  step("automation", "Automatic search and download", "How often to search and grab", hasDownload),
  step("import", "Library folder and import", "Where finished downloads end up", hasDownload),
  step("steam", "Steam", "Import your library, playtime and achievements", plays("pc")),
  step("retroachievements", "RetroAchievements", "Track retro achievements", plays("retro")),
  step("xbox", "Xbox achievements", "Track Xbox achievements", plays("xbox"), false, 2),
  step("psn", "PlayStation trophies", "Track PlayStation trophies", plays("playstation"), false, 2),
  step("nexusmods", "NexusMods", "Find mods for your PC games", plays("pc")),
  step("notifications", "Notifications", "Get alerts outside the app", (a) => a.notifications),
  step("privacy", "Quests and diagnostics", "Backlog quests and error reporting", always, true),
  step("summary", "All set", "What was configured", always, true),
];

/**
 * Bumped whenever a step is added: a step's `since` is the revision that introduced it. Finishing
 * or dismissing the wizard records the revision the user has seen, so the prompt can come back
 * when later releases add steps.
 */
export const WIZARD_REVISION = Math.max(...WIZARD_STEPS.map((s) => s.since));

/** The revision of installs that finished the wizard before revisions were recorded. */
export const INITIAL_WIZARD_REVISION = 1;

/** Steps added after the revision the user last saw, optionally limited to what can be shown. */
export function wizardStepsSince(
  seenRevision: number,
  canRender: (id: WizardStepId) => boolean = () => true
): WizardStepDef[] {
  return WIZARD_STEPS.filter((s) => s.since > seenRevision && canRender(s.id));
}

/**
 * The steps to walk through, in order. With `onlyUnconfigured`, a step whose settings are already
 * in place is dropped, so someone upgrading from an old version only sees what is new to them.
 */
export function visibleWizardSteps(
  answers: WizardAnswers,
  configured: WizardConfigured = {},
  onlyUnconfigured = false
): WizardStepDef[] {
  return WIZARD_STEPS.filter((step) => {
    if (!step.when(answers)) return false;
    if (onlyUnconfigured && !step.alwaysShown && configured[step.id]) return false;
    return true;
  });
}

/** Answers guessed from what is already configured, so the question step starts informed. */
export function inferWizardAnswers(configured: WizardConfigured): WizardAnswers {
  const platforms: WizardPlatform[] = [];
  if (configured.steam) platforms.push("pc");
  if (configured.retroachievements) platforms.push("retro");
  if (configured.xbox) platforms.push("xbox");
  if (configured.psn) platforms.push("playstation");
  return {
    platforms,
    download: Boolean(configured.indexers || configured.downloaders),
    notifications: Boolean(configured.notifications),
  };
}
