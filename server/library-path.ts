import path from "node:path";
import { PLATFORM_CATALOG } from "../shared/title-utils.js";
import { rommSlugForPlatformId } from "../shared/romm-platforms.js";

export type LibraryTargetSafety =
  | { safe: true; resolvedTarget: string }
  | {
      safe: false;
      resolvedTarget: string;
      reason: "outside-library-root" | "library-root" | "shared-platform-directory";
    };

// These names cover both the readable folders used by older Questarr imports and
// the current RomM/platform catalog. A game must never use the library root or a
// shared platform directory as its own libraryPath.
const LEGACY_PLATFORM_FOLDER_NAMES = [
  "NES",
  "SNES",
  "N64",
  "GameCube",
  "Wii",
  "Wii U",
  "Game Boy",
  "Game Boy Color",
  "Game Boy Advance",
  "Nintendo DS",
  "Nintendo 3DS",
  "Switch",
  "PlayStation",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "PS5",
  "PSP",
  "PS Vita",
  "Xbox",
  "Xbox 360",
  "Xbox One",
  "Xbox Series",
  "PC",
  "Linux",
  "Mac",
] as const;

const SHARED_PLATFORM_DIRECTORY_NAMES = new Set(
  [
    ...LEGACY_PLATFORM_FOLDER_NAMES,
    ...PLATFORM_CATALOG.flatMap(({ canonical, igdbNames, igdbIds }) => [
      canonical,
      ...igdbNames,
      ...igdbIds.map((id) => rommSlugForPlatformId(id)).filter((slug): slug is string => !!slug),
    ]),
  ].map((name) => name.toLowerCase())
);

/**
 * Validates a stored game library target without touching the filesystem.
 * The caller can perform canonical/realpath checks separately when the target
 * exists; this helper handles traversal, root targets, and shared platform dirs.
 */
export function assessLibraryTarget(libraryRoot: string, candidate: string): LibraryTargetSafety {
  const resolvedRoot = path.resolve(libraryRoot);
  const resolvedTarget = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative === "") {
    return { safe: false, resolvedTarget, reason: "library-root" };
  }

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { safe: false, resolvedTarget, reason: "outside-library-root" };
  }

  if (
    path.dirname(resolvedTarget) === resolvedRoot &&
    SHARED_PLATFORM_DIRECTORY_NAMES.has(path.basename(resolvedTarget).toLowerCase())
  ) {
    return { safe: false, resolvedTarget, reason: "shared-platform-directory" };
  }

  return { safe: true, resolvedTarget };
}
