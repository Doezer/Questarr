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
  alwaysShown?: boolean;
}

const always = () => true;
const plays = (platform: WizardPlatform) => (a: WizardAnswers) => a.platforms.includes(platform);

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  {
    id: "questions",
    title: "About your setup",
    summary: "Where you play and what Questarr should do for you",
    when: always,
    alwaysShown: true,
  },
  {
    id: "igdb",
    title: "Game database (IGDB)",
    summary: "Credentials Questarr uses to find game metadata and covers",
    when: always,
  },
  {
    id: "platforms",
    title: "Platforms",
    summary: "Limit platform filters and imports to the ones you use",
    when: always,
  },
  {
    id: "indexers",
    title: "Indexers",
    summary: "Where Questarr looks for releases",
    when: (a) => a.download,
  },
  {
    id: "downloaders",
    title: "Download clients",
    summary: "The client that fetches releases",
    when: (a) => a.download,
  },
  {
    id: "automation",
    title: "Automatic search and download",
    summary: "How often to search, and whether to grab releases for you",
    when: (a) => a.download,
  },
  {
    id: "import",
    title: "Library folder and import",
    summary: "Where finished downloads end up and how they are renamed",
    when: (a) => a.download,
  },
  {
    id: "steam",
    title: "Steam",
    summary: "Import your Steam library, playtime and achievements",
    when: plays("pc"),
  },
  {
    id: "retroachievements",
    title: "RetroAchievements",
    summary: "Track retro achievements",
    when: plays("retro"),
  },
  {
    id: "xbox",
    title: "Xbox achievements",
    summary: "Track Xbox achievements",
    when: plays("xbox"),
  },
  {
    id: "psn",
    title: "PlayStation trophies",
    summary: "Track PlayStation trophies",
    when: plays("playstation"),
  },
  {
    id: "nexusmods",
    title: "NexusMods",
    summary: "Find mods for your PC games",
    when: plays("pc"),
  },
  {
    id: "notifications",
    title: "Notifications",
    summary: "Get alerts outside the app",
    when: (a) => a.notifications,
  },
  {
    id: "privacy",
    title: "Quests and diagnostics",
    summary: "Backlog quests and error reporting",
    when: always,
    alwaysShown: true,
  },
  {
    id: "summary",
    title: "All set",
    summary: "What was configured",
    when: always,
    alwaysShown: true,
  },
];

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
