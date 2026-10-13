/**
 * RomM platform folders.
 *
 * RomM scans `<library>/roms/<fs_slug>/...` and recognises the platform from the folder name,
 * which by default is the IGDB platform slug ("snes", "ps2", "win"...). Questarr only needs the
 * IGDB platform id -> slug table to place imports where RomM looks for them.
 *
 * The table follows the layout used by the RomM integration branch of Questarr (Doezer),
 * as extended and tested in snapetech/QuestarrNG, and by the retro fork of Jeremy Stover
 * (Kadajett/Questarr); rewritten here.
 */
export const ROMM_SLUG_BY_IGDB_PLATFORM_ID: Readonly<Record<number, string>> = {
  3: "linux",
  4: "n64",
  5: "wii",
  6: "win",
  7: "ps",
  8: "ps2",
  9: "ps3",
  11: "xbox",
  12: "xbox360",
  14: "mac",
  18: "nes",
  19: "snes",
  20: "nds",
  21: "ngc",
  22: "gbc",
  23: "dc",
  24: "gba",
  29: "genesis-slash-megadrive",
  32: "saturn",
  33: "gb",
  35: "gamegear",
  37: "3ds",
  38: "psp",
  41: "wiiu",
  46: "psvita",
  48: "ps4--1",
  49: "xboxone",
  52: "arcade",
  59: "atari2600",
  60: "atari7800",
  61: "lynx",
  62: "jaguar",
  64: "sms",
  66: "atari5200",
  80: "neogeoaes",
  86: "turbografx16--1",
  119: "ngp",
  120: "ngpc",
  130: "switch",
  167: "ps5",
  169: "series-x-s",
};

const ROMM_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** True for a folder name that is safe to join under the library root. */
export function isValidRommSlug(slug: string): boolean {
  return ROMM_SLUG_PATTERN.test(slug) && !slug.includes("..");
}

export function rommSlugForPlatformId(platformId: number | undefined): string | undefined {
  if (platformId === undefined) return undefined;
  return ROMM_SLUG_BY_IGDB_PLATFORM_ID[platformId];
}
