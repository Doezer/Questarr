import { describe, expect, it } from "vitest";
import {
  SETTINGS_PAGES,
  legacySettingsSlug,
  settingsPageFromPath,
  settingsPagePath,
} from "../src/lib/settings-pages";
import { getPageTitle, managementNavigation } from "../src/components/navigation-items";
import { appRoutePaths } from "../src/lib/routes";

describe("settings pages", () => {
  it("finds the section for its path, with or without a trailing slash", () => {
    expect(settingsPageFromPath("/settings/connections")?.title).toBe("Connections");
    expect(settingsPageFromPath("/settings/connections/")?.title).toBe("Connections");
    expect(settingsPageFromPath("/settings")).toBeUndefined();
    expect(settingsPageFromPath("/settings/nope")).toBeUndefined();
    expect(settingsPageFromPath("/settings/connections/extra")).toBeUndefined();
  });

  it("has one unique slug and content id per section", () => {
    expect(new Set(SETTINGS_PAGES.map((page) => page.slug)).size).toBe(SETTINGS_PAGES.length);
    expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(SETTINGS_PAGES.length);
  });

  it("maps older ?tab= links and moved cards to a section", () => {
    expect(legacySettingsSlug("?tab=integrations", "")).toBe("connections");
    expect(legacySettingsSlug("?tab=account-security", "")).toBe("security");
    expect(legacySettingsSlug("?tab=discovery", "#classification-review")).toBe("release-scoring");
    expect(legacySettingsSlug("?tab=unknown", "")).toBeNull();
    expect(legacySettingsSlug("", "#__proto__")).toBeNull();
    expect(legacySettingsSlug("", "")).toBeNull();
  });

  it("lists every section under Settings in the navigation and the route table", () => {
    const settings = managementNavigation.find((item) => item.url === "/settings");
    expect(settings?.children?.map((child) => child.url)).toEqual(
      SETTINGS_PAGES.map((page) => settingsPagePath(page.slug))
    );
    for (const page of SETTINGS_PAGES) {
      expect(appRoutePaths).toContain(settingsPagePath(page.slug));
    }
  });

  it("titles every settings page Settings in the header", () => {
    expect(getPageTitle("/settings")).toBe("Settings");
    expect(getPageTitle("/settings/release-scoring")).toBe("Settings");
  });
});
