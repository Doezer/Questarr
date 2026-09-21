// Transport-level xREL types shared between the server (server/xrel.ts,
// which maps xREL's raw API responses into these) and the client
// (client/src/pages/xrel-releases.tsx). Keep this to fields that actually
// cross the wire -- page-only/derived fields (e.g. isWanted) belong in a
// local extension type on the client instead.

export interface XrelExtInfo {
  type: string;
  id: string;
  title: string;
  link_href: string;
  rating?: number;
  num_ratings?: number;
}

// Identity fields common to every xREL release shape -- xREL's raw scene
// and p2p release types (server/xrel.ts) and the normalized list item
// below -- factored out so they're declared once instead of drifting.
export interface XrelReleaseIdentity {
  id: string;
  dirname: string;
  link_href: string;
}

export interface XrelReleaseListItem extends XrelReleaseIdentity {
  time: number;
  group_name: string;
  sizeMb?: number;
  sizeUnit?: string;
  ext_info?: XrelExtInfo;
  source: "scene" | "p2p";
  // Normalized from XrelSceneRelease.nuke_reason (with a fallback for
  // flag-only nukes -- see deriveNukeReason in server/xrel.ts). Only ever
  // set for scene releases -- xREL's p2p releases don't carry nuke metadata.
  nukeReason?: string;
  // "hypervisor" vs "cracked" -- see deriveCrackType() below.
  crackType: "hypervisor" | "cracked";
}

/**
 * xREL doesn't expose a structured "crack method" field -- groups that bypass
 * DRM via a hypervisor (e.g. Denuvo VM bypass) instead of a traditional crack
 * flag it directly in the release dirname (e.g. "Game.Name.HYPERVISOR-EMPRESS").
 * Fall back to "cracked" for everything else.
 */
export function deriveCrackType(dirname: string): "hypervisor" | "cracked" {
  return /\bhypervisor\b/i.test(dirname) ? "hypervisor" : "cracked";
}

// Response contract for GET /api/games/:id/xrel-status (server/routes.ts),
// consumed by the game detail page's Crack Status section.
export interface XrelGameStatus {
  crackTypes: ("cracked" | "hypervisor")[];
}
