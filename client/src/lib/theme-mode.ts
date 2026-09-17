/** Shared localStorage keys for application themes. */
export const THEME_KEY = "questarr-selected-theme";

export type Theme = "default" | "win2k" | "ghost";

export const THEMES: Theme[] = ["default", "win2k", "ghost"];

export interface ThemeConfig {
  id: Theme;
  name: string;
  description: string;
  className: string;
  icon?: string;
}

export const THEME_CONFIGS: Record<Theme, ThemeConfig> = {
  default: {
    id: "default",
    name: "Original",
    description: "The default Questarr theme",
    className: "",
  },
  win2k: {
    id: "win2k",
    name: "Windows 2000",
    description:
      "A cosmetic retro skin with navy title bars, silver beveled buttons, square corners, and Tahoma type",
    className: "theme-win2k",
  },
  ghost: {
    id: "ghost",
    name: "Ghost",
    description: "A cosmetic accent color, unlocked by hacking the terminal in Ghost the Terminal",
    className: "theme-ghost",
  },
};

/** Legacy keys for migration */
export const GHOST_UNLOCK_KEY = "questarr-ghost-unlocked";
export const GHOST_THEME_KEY = "questarr-ghost-theme-enabled";
export const WIN2K_THEME_KEY = "questarr-win2k-theme-enabled";

/**
 * Migrate from legacy theme keys to new unified theme key.
 * Returns the current theme based on legacy keys or the new key.
 */
export function getCurrentTheme(ghostUnlocked: boolean): Theme {
  // Check if new theme key exists
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme && THEMES.includes(savedTheme as Theme)) {
    return savedTheme as Theme;
  }

  // Migrate from legacy keys
  const ghostEnabled = localStorage.getItem(GHOST_THEME_KEY) === "true";
  const win2kEnabled = localStorage.getItem(WIN2K_THEME_KEY) === "true";

  if (ghostEnabled && ghostUnlocked) {
    return "ghost";
  } else if (win2kEnabled) {
    return "win2k";
  }

  return "default";
}

/**
 * Resolve the current theme (via `getCurrentTheme`) and persist it under the new
 * `THEME_KEY`, removing the legacy keys it may have been migrated from. Call this
 * once on startup and once when the Settings page mounts, so legacy keys are
 * cleaned up even for users who never open the theme dropdown.
 */
export function migrateLegacyTheme(ghostUnlocked: boolean): Theme {
  const theme = getCurrentTheme(ghostUnlocked);
  localStorage.setItem(THEME_KEY, theme);
  localStorage.removeItem(GHOST_THEME_KEY);
  localStorage.removeItem(WIN2K_THEME_KEY);
  return theme;
}

/**
 * Apply the given theme's class to the document root, removing any other theme
 * classes first. The "default" theme has an empty className, so it is skipped
 * to avoid `DOMTokenList.remove("")` / `.add("")` throwing a SyntaxError.
 */
export function applyThemeClass(theme: Theme): void {
  THEMES.forEach((t) => {
    const className = THEME_CONFIGS[t].className;
    if (className) {
      document.documentElement.classList.remove(className);
    }
  });

  const className = THEME_CONFIGS[theme].className;
  if (className) {
    document.documentElement.classList.add(className);
  }
}

/**
 * Set the theme and clean up legacy keys.
 */
export function setTheme(theme: Theme, ghostUnlocked: boolean): void {
  // Don't allow ghost if not unlocked
  if (theme === "ghost" && !ghostUnlocked) {
    return;
  }

  // Set new theme key
  localStorage.setItem(THEME_KEY, theme);

  applyThemeClass(theme);

  // Clean up legacy keys
  localStorage.removeItem(GHOST_THEME_KEY);
  localStorage.removeItem(WIN2K_THEME_KEY);
}
