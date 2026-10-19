import type { FormatSpec } from "./release-scoring.js";

export interface DefaultCustomFormat {
  name: string;
  specs: FormatSpec[];
  score: number;
  hardReject: boolean;
}

const title = (value: string): FormatSpec => ({ field: "title", mode: "regex", value });

/**
 * Recommended starting formats. Updates and DLC are searched for too, so nothing here
 * penalizes a release for being one; only things that are not the game itself are pushed down.
 * Matching is case-insensitive and runs on RE2 (no lookarounds).
 */
export const DEFAULT_CUSTOM_FORMATS: readonly DefaultCustomFormat[] = [
  {
    name: "Crack, fix or NoCD only",
    specs: [
      title(
        String.raw`(^|[^a-z0-9])(crack(ed)?[ ._-]?only|crack[ ._-]?fix|nocd|no[ ._-]?dvd|(online|steam|multiplayer)[ ._-]?fix|fix[ ._-]?only|unlocker)([^a-z0-9]|$)`
      ),
    ],
    score: -300,
    hardReject: false,
  },
  {
    name: "Demo, playtest or trial",
    specs: [
      title(
        String.raw`(^|[^a-z0-9])(demo|playtest|trial|beta[ ._-]?test|closed[ ._-]?beta)([^a-z0-9]|$)`
      ),
    ],
    score: -150,
    hardReject: false,
  },
  {
    name: "Trainer, keygen or activator",
    specs: [
      title(
        String.raw`(^|[^a-z0-9])(trainer|keygen|key[ ._-]?generator|activator|patcher|cheat[ ._-]?engine)([^a-z0-9]|$)`
      ),
    ],
    score: -500,
    hardReject: true,
  },
  {
    name: "Pre-installed",
    specs: [
      title(
        String.raw`(^|[^a-z0-9])(pre[ ._-]?installed|preinstalled|already[ ._-]?installed)([^a-z0-9]|$)`
      ),
    ],
    score: -40,
    hardReject: false,
  },
  {
    name: "Includes updates and DLC",
    specs: [
      title(
        String.raw`(^|[^a-z0-9])(incl(uding|udes)?[ ._-]?(all[ ._-]?)?(dlcs?|updates?)|all[ ._-]?dlcs?|complete[ ._-]?edition|goty|game[ ._-]?of[ ._-]?the[ ._-]?year)([^a-z0-9]|$)`
      ),
    ],
    score: 25,
    hardReject: false,
  },
  {
    name: "Trusted repackers",
    specs: [
      {
        field: "group",
        mode: "regex",
        value: String.raw`^(fitgirl|dodi|elamigos|kaoskrew|gog)$`,
      },
    ],
    score: 20,
    hardReject: false,
  },
];
