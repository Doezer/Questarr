import { storage } from "./storage.js";

/** The two content-filter signals are independent user settings: "Erotic" theme vs. ESRB AO/PEGI 18 age ratings. */
export interface ContentFilterFlags {
  hideAdultContent: boolean;
  hideAgeRestrictedContent: boolean;
}

/** Reads a user's content-filter preferences, defaulting to the safest setting. */
export async function getContentFilterFlags(userId: string): Promise<ContentFilterFlags> {
  const settings = await storage.getUserSettings(userId);
  return {
    hideAdultContent: settings?.hideAdultContent ?? true,
    hideAgeRestrictedContent: settings?.hideAgeRestrictedContent ?? true,
  };
}

export function isContentFiltered(
  game: { isAdultContent?: boolean; isAgeRestricted?: boolean },
  flags: ContentFilterFlags
): boolean {
  return (
    (flags.hideAdultContent && game.isAdultContent === true) ||
    (flags.hideAgeRestrictedContent && game.isAgeRestricted === true)
  );
}

export function excludeFilteredContent<T>(games: T[], flags: ContentFilterFlags): T[] {
  return games.filter(
    (g) => !isContentFiltered(g as { isAdultContent?: boolean; isAgeRestricted?: boolean }, flags)
  );
}
