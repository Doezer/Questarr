import { AchievementAccountSync } from "./AchievementAccountSync";

/** Save an OpenXBL key, turn the Xbox achievement sync on or off and run it on demand. */
export function XboxAchievementsSync() {
  return (
    <AchievementAccountSync
      idPrefix="xbox-achievements"
      apiPath="/api/xbox-achievements"
      label="Xbox"
      secretLabel="OpenXBL API key"
      secretBodyKey="apiKey"
      saveHint="Save your OpenXBL API key above to use this."
      description={
        <>
          Track the achievement progress of your Xbox games through OpenXBL, a third-party Xbox Live
          API with a free key. A game is matched by its title and its platform, so its platform must
          be set. Sign in at{" "}
          <a
            href="https://xbl.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            xbl.io
          </a>{" "}
          with your Microsoft account and copy your API key. The free plan is limited to 150
          requests an hour, far more than a sync needs.
        </>
      }
    />
  );
}
