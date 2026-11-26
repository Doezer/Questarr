import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { WizardConfigured } from "@shared/setup-wizard";

export type SetupWizardState = "pending" | "done" | "never";

export const SETUP_WIZARD_STATE_KEY = ["/api/system/setup-wizard"];

async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    return (await (await apiRequest("GET", path)).json()) as T;
  } catch {
    // A status that cannot be read counts as "not configured": the step is simply shown.
    return undefined;
  }
}

export function useSetupWizardState() {
  return useQuery<{
    state: SetupWizardState;
    /** Revision of the wizard the user last finished or dismissed. */
    seenRevision?: number;
  }>({
    queryKey: SETUP_WIZARD_STATE_KEY,
    queryFn: async () => (await apiRequest("GET", SETUP_WIZARD_STATE_KEY[0]!)).json(),
  });
}

export interface WizardStatus {
  configured: WizardConfigured;
  indexerCount: number;
  downloaderCount: number;
  isLoading: boolean;
  /** True once the status was read again after this page opened (not a cached answer). */
  isFresh: boolean;
  refresh: () => void;
}

/** What is already set up, read from the same endpoints the Settings pages use. */
export function useWizardStatus(): WizardStatus {
  const { data, isLoading, isFetchedAfterMount, refetch } = useQuery({
    queryKey: ["/api/system/setup-wizard", "status"],
    // The wizard is where configuration changes, so never serve a stale answer.
    staleTime: 0,
    queryFn: async () => {
      const [config, indexers, downloaders, steam, retro, xbox, psn, nexus, apprise, settings, me] =
        await Promise.all([
          getJson<{ igdb?: { configured?: boolean } }>("/api/config"),
          getJson<unknown[]>("/api/indexers"),
          getJson<unknown[]>("/api/downloaders"),
          getJson<{ apiKeyConfigured?: boolean }>("/api/settings/steam"),
          getJson<{ available?: boolean }>("/api/retroachievements"),
          getJson<{ available?: boolean }>("/api/xbox-achievements"),
          getJson<{ available?: boolean }>("/api/psn-achievements"),
          getJson<{ configured?: boolean }>("/api/settings/nexusmods"),
          getJson<{ configured?: boolean }>("/api/settings/apprise"),
          getJson<{ importPlatformIds?: number[] | null }>("/api/settings"),
          getJson<{ steamId64?: string | null }>("/api/auth/me"),
        ]);
      const indexerCount = Array.isArray(indexers) ? indexers.length : 0;
      const downloaderCount = Array.isArray(downloaders) ? downloaders.length : 0;
      const configured: WizardConfigured = {
        igdb: Boolean(config?.igdb?.configured),
        platforms: Boolean(settings?.importPlatformIds?.length),
        indexers: indexerCount > 0,
        downloaders: downloaderCount > 0,
        // Both the key and the account's Steam ID are needed for the Steam features.
        steam: Boolean(steam?.apiKeyConfigured && me?.steamId64),
        retroachievements: Boolean(retro?.available),
        xbox: Boolean(xbox?.available),
        psn: Boolean(psn?.available),
        nexusmods: Boolean(nexus?.configured),
        notifications: Boolean(apprise?.configured),
      };
      return { configured, indexerCount, downloaderCount };
    },
  });
  const refresh = useCallback(() => void refetch(), [refetch]);
  return {
    configured: data?.configured ?? {},
    indexerCount: data?.indexerCount ?? 0,
    downloaderCount: data?.downloaderCount ?? 0,
    isLoading,
    isFresh: isFetchedAfterMount,
    refresh,
  };
}
